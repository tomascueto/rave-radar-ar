"""
Endpoints del flujo de login con Google. Una vez logueado, el resto del
sistema (incluido el chat) nunca vuelve a hablar con Google -- solo con
los JWT propios emitidos aca.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import SQLAlchemyError

from auth.dependencies import get_current_user
from auth.email_utils import send_email
from auth.google_oauth import build_login_url, exchange_code_for_profile, generate_state
from auth.jwt_utils import (
    create_access_token, generate_refresh_token, hash_refresh_token,
    generate_random_token, hash_token, REFRESH_TOKEN_EXPIRE_DAYS,
)
from auth.password_utils import hash_password, verify_password
from database.connection import SessionLocal
from database.models import (
    AuthProviderEnum, EmailVerificationToken, OAuthAccount, RefreshToken, User,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"

STATE_COOKIE = "oauth_state"
REFRESH_COOKIE = "refresh_token"
EMAIL_VERIFICATION_EXPIRE_HOURS = 24


@router.get("/google/login")
def google_login():
    state = generate_state()
    login_url = build_login_url(state)
    response = RedirectResponse(login_url)
    # httponly: JS nunca puede leer esta cookie. Se compara contra el
    # 'state' que Google nos devuelva, para confirmar que la respuesta
    # corresponde a un login que efectivamente iniciamos nosotros (protege
    # contra CSRF en el flujo de OAuth).
    response.set_cookie(
        STATE_COOKIE, state,
        httponly=True, samesite="lax", secure=False, max_age=600,
    )
    return response


@router.get("/google/callback")
def google_callback(code: str, state: str, oauth_state: str | None = Cookie(default=None)):
    if not oauth_state or state != oauth_state:
        raise HTTPException(status_code=400, detail="Estado inválido - posible intento de CSRF")

    try:
        profile = exchange_code_for_profile(code)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo validar el login con Google")

    db = SessionLocal()
    try:
        oauth_account = (
            db.query(OAuthAccount)
            .filter(
                OAuthAccount.provider == AuthProviderEnum.google,
                OAuthAccount.provider_account_id == profile["sub"],
            )
            .first()
        )

        if oauth_account:
            user = db.query(User).filter(User.id == oauth_account.user_id).first()
        else:
            # Primer login: puede que el email ya exista (por ejemplo, si
            # mas adelante se suma login por contrasena) -- en ese caso se
            # vincula la cuenta de Google a ese usuario existente, en vez
            # de crear un duplicado.
            user = db.query(User).filter(User.email == profile["email"]).first()
            if user is None:
                user = User(
                    email=profile["email"],
                    display_name=profile.get("name"),
                    avatar_url=profile.get("picture"),
                    is_email_verified=True,  # Google ya lo verifico
                )
                db.add(user)
                db.flush()  # asigna user.id sin cerrar la transaccion

            oauth_account = OAuthAccount(
                user_id=user.id,
                provider=AuthProviderEnum.google,
                provider_account_id=profile["sub"],
            )
            db.add(oauth_account)

        access_token = create_access_token(user.id)
        raw_refresh, refresh_hash = generate_refresh_token()
        db.add(RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        ))

        db.commit()

    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error creando la sesión")
    finally:
        db.close()

    redirect = RedirectResponse(f"{FRONTEND_URL}/auth/callback?access_token={access_token}")
    redirect.delete_cookie(STATE_COOKIE)
    redirect.set_cookie(
        REFRESH_COOKIE, raw_refresh,
        httponly=True, samesite="lax", secure=False,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )
    return redirect


@router.post("/refresh")
def refresh_access_token(refresh_token: str | None = Cookie(default=None)):
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No hay sesión activa")

    token_hash = hash_refresh_token(refresh_token)
    db = SessionLocal()
    try:
        stored = (
            db.query(RefreshToken)
            .filter(RefreshToken.token_hash == token_hash, RefreshToken.is_revoked == False)
            .first()
        )
        if stored is None or stored.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Sesión expirada, iniciá sesión de nuevo")

        access_token = create_access_token(stored.user_id)
        return {"access_token": access_token}
    finally:
        db.close()


@router.post("/logout")
def logout(refresh_token: str | None = Cookie(default=None)):
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        db = SessionLocal()
        try:
            db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).update(
                {"is_revoked": True}
            )
            db.commit()
        finally:
            db.close()

    response = Response(status_code=204)
    response.delete_cookie(REFRESH_COOKIE)
    return response


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    """Devuelve los datos del usuario logueado -- lo usa el frontend para
    mostrar nombre/avatar sin tener que decodificar el JWT del lado del
    cliente."""
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
    }


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    display_name: str | None = None


@router.post("/register", status_code=201)
def register(body: RegisterIn):
    """
    Crea una cuenta con email y contraseña. La cuenta queda creada pero
    SIN poder loguearse todavía -- is_email_verified arranca en False, y
    /login rechaza cualquier intento hasta que se confirme el mail. Si ya
    existe una cuenta con ese email (por cualquier método, Google
    incluido), se rechaza con 409 en vez de crear un duplicado.
    """
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == body.email).first()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email")

        user = User(
            email=body.email,
            password_hash=hash_password(body.password),
            display_name=body.display_name,
            is_email_verified=False,
        )
        db.add(user)
        db.flush()

        raw_token, token_hash = generate_random_token()
        db.add(EmailVerificationToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFICATION_EXPIRE_HOURS),
        ))
        db.commit()

    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo crear la cuenta")
    finally:
        db.close()

    verify_url = f"{BACKEND_URL}/api/auth/verify-email?token={raw_token}"
    send_email(
        to_email=body.email,
        subject="Confirmá tu cuenta en Rave Radar AR",
        html_content=(
            f"<p>¡Gracias por registrarte en Rave Radar AR!</p>"
            f"<p><a href='{verify_url}'>Hacé click acá para confirmar tu cuenta</a></p>"
            f"<p>Si no fuiste vos, podés ignorar este mail.</p>"
        ),
    )

    return {"message": "Cuenta creada. Revisá tu email (y la carpeta de spam) para confirmarla."}


@router.get("/verify-email")
def verify_email(token: str):
    """El link del mail de confirmación apunta acá. Si el token es válido
    y no expiró, marca la cuenta como verificada y redirige al frontend."""
    token_hash = hash_token(token)
    db = SessionLocal()
    try:
        record = (
            db.query(EmailVerificationToken)
            .filter(EmailVerificationToken.token_hash == token_hash, EmailVerificationToken.used_at.is_(None))
            .first()
        )
        if record is None or record.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="El link de verificación es inválido o expiró")

        user = db.query(User).filter(User.id == record.user_id).first()
        user.is_email_verified = True
        record.used_at = datetime.now(timezone.utc)
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo verificar la cuenta")
    finally:
        db.close()

    return RedirectResponse(f"{FRONTEND_URL}/?verified=true")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
def login(body: LoginIn):
    """
    Login por email y contraseña. Emite el mismo tipo de sesión que el
    login con Google (access token + refresh cookie httponly) -- /refresh
    y /logout ya construidos para Google funcionan igual acá, sin ningún
    cambio, porque ambos caminos terminan en la misma tabla RefreshToken.
    """
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == body.email).first()

        # Mismo mensaje genérico sin importar CUÁL de estas tres cosas
        # falló (el email no existe, la cuenta es solo-Google sin
        # contraseña, o la contraseña no coincide) -- evita que la
        # respuesta permita deducir qué emails están registrados.
        credenciales_invalidas = HTTPException(
            status_code=401, detail="Email o contraseña incorrectos"
        )
        if user is None or user.password_hash is None:
            raise credenciales_invalidas
        if not verify_password(body.password, user.password_hash):
            raise credenciales_invalidas

        if not user.is_email_verified:
            raise HTTPException(status_code=403, detail="Confirmá tu email antes de iniciar sesión")

        access_token = create_access_token(user.id)
        raw_refresh, refresh_hash = generate_refresh_token()
        db.add(RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        ))
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo iniciar sesión")
    finally:
        db.close()

    response = JSONResponse({"access_token": access_token})
    response.set_cookie(
        REFRESH_COOKIE, raw_refresh,
        httponly=True, samesite="lax", secure=False,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )
    return response