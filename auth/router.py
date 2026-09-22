"""
Endpoints del flujo de login con Google. Una vez logueado, el resto del
sistema (incluido el chat) nunca vuelve a hablar con Google -- solo con
los JWT propios emitidos aca.
"""
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

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
    AuthProviderEnum, EmailVerificationToken, OAuthAccount, PasswordResetToken,
    RefreshToken, User,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"

STATE_COOKIE = "oauth_state"
REFRESH_COOKIE = "refresh_token"
LINK_USER_COOKIE = "link_user_id"
EMAIL_VERIFICATION_EXPIRE_HOURS = 24
PASSWORD_RESET_EXPIRE_HOURS = 2


@router.get("/google/login")
def google_login(link: bool = False, refresh_token: str | None = Cookie(default=None)):
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

    if link:
        # Flujo de VINCULACION: un usuario YA logueado quiere sumar Google
        # como metodo de acceso adicional a su cuenta existente (no crear
        # ni loguear a otro usuario). Como esto es una redireccion de
        # navegador completa (no un fetch con header Authorization), la
        # unica forma de saber quien es "el usuario actual" es a traves
        # de la cookie de refresh, que si viaja automaticamente en una
        # navegacion al mismo origen.
        if not refresh_token:
            raise HTTPException(status_code=401, detail="Necesitás una sesión activa para vincular una cuenta")

        db = SessionLocal()
        try:
            token_hash = hash_refresh_token(refresh_token)
            record = (
                db.query(RefreshToken)
                .filter(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_revoked == False,
                    RefreshToken.expires_at > datetime.now(timezone.utc),
                )
                .first()
            )
            if record is None:
                raise HTTPException(status_code=401, detail="Sesión inválida o expirada")

            response.set_cookie(
                LINK_USER_COOKIE, str(record.user_id),
                httponly=True, samesite="lax", secure=False, max_age=600,
            )
        finally:
            db.close()

    return response


def _link_error_redirect(message: str) -> RedirectResponse:
    """Solo para el flujo de VINCULACION (link_user_id presente): en vez
    de una excepcion cruda -- el navegador quedaria mostrando el JSON del
    backend en vez de volver a la app, porque este endpoint es una
    redireccion de navegador completa, no un fetch -- vuelve a la app con
    el motivo en un query param que el panel de usuario puede leer y
    mostrar prolijamente. El flujo de login normal (sin link_user_id) no
    se toca: sigue devolviendo la excepcion cruda de siempre."""
    redirect = RedirectResponse(f"{FRONTEND_URL}/?google_link_error={quote(message)}")
    redirect.delete_cookie(STATE_COOKIE)
    redirect.delete_cookie(LINK_USER_COOKIE)
    return redirect


@router.get("/google/callback")
def google_callback(
    code: str, state: str,
    oauth_state: str | None = Cookie(default=None),
    link_user_id: str | None = Cookie(default=None),
):
    if not oauth_state or state != oauth_state:
        if link_user_id:
            return _link_error_redirect("Estado inválido - posible intento de CSRF")
        raise HTTPException(status_code=400, detail="Estado inválido - posible intento de CSRF")

    try:
        profile = exchange_code_for_profile(code)
    except Exception:
        if link_user_id:
            return _link_error_redirect("No se pudo validar el login con Google")
        raise HTTPException(status_code=400, detail="No se pudo validar el login con Google")

    db = SessionLocal()
    try:
        existing_oauth = (
            db.query(OAuthAccount)
            .filter(
                OAuthAccount.provider == AuthProviderEnum.google,
                OAuthAccount.provider_account_id == profile["sub"],
            )
            .first()
        )

        if link_user_id:
            # Flujo de VINCULACION: el usuario ya estaba logueado (identificado
            # por la cookie que /google/login seteo con link=true) y quiere
            # sumar esta cuenta de Google a SU MISMO usuario -- nunca crear
            # ni loguear a un usuario distinto.
            try:
                target_user_id = uuid.UUID(link_user_id)
            except ValueError:
                return _link_error_redirect("Sesión de vinculación inválida")

            user = db.query(User).filter(User.id == target_user_id).first()
            if user is None:
                return _link_error_redirect("Sesión de vinculación inválida")

            if existing_oauth and existing_oauth.user_id != user.id:
                # Esa cuenta de Google ya esta vinculada a OTRO usuario --
                # no permitir. Evita que dos usuarios terminen compartiendo
                # sin querer el mismo metodo de acceso.
                return _link_error_redirect("Esa cuenta de Google ya está vinculada a otro usuario")

            if existing_oauth is None:
                db.add(OAuthAccount(
                    user_id=user.id,
                    provider=AuthProviderEnum.google,
                    provider_account_id=profile["sub"],
                ))
                if user.avatar_url is None:
                    # Vincular Google a una cuenta preexistente no traia
                    # la foto de perfil -- solo pasaba en el flujo de
                    # creacion/login normal. No pisa una foto que el
                    # usuario ya tuviera (no existe forma de subir una
                    # propia hoy, pero por las dudas).
                    user.avatar_url = profile.get("picture")
            # Si existing_oauth ya existe y ya es de este mismo usuario, no
            # hay nada que hacer -- la vinculación ya estaba hecha (idempotente).

        else:
            # Flujo normal de login/registro -- sin cambios respecto al que
            # ya existía.
            if existing_oauth:
                user = db.query(User).filter(User.id == existing_oauth.user_id).first()
            else:
                # Primer login: puede que el email ya exista (por ejemplo, si
                # ya se registró por contraseña) -- en ese caso se vincula la
                # cuenta de Google a ese usuario existente, en vez de crear
                # un duplicado.
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

                db.add(OAuthAccount(
                    user_id=user.id,
                    provider=AuthProviderEnum.google,
                    provider_account_id=profile["sub"],
                ))

        access_token = create_access_token(user.id)
        raw_refresh, refresh_hash = generate_refresh_token()
        db.add(RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        ))

        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        if link_user_id:
            return _link_error_redirect("Error creando la sesión")
        raise HTTPException(status_code=500, detail="Error creando la sesión")
    finally:
        db.close()

    callback_url = f"{FRONTEND_URL}/auth/callback?access_token={access_token}"
    if link_user_id:
        # Exito silencioso -- incluye la cuenta ya vinculada a si misma
        # (idempotente) -- el panel de usuario usa esto para mostrar una
        # confirmacion en vez de redirigir sin avisar nada, igual patron
        # que _link_error_redirect para el caso de error.
        callback_url += "&google_linked=true"
    redirect = RedirectResponse(callback_url)
    redirect.delete_cookie(STATE_COOKIE)
    redirect.delete_cookie(LINK_USER_COOKIE)
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
    db = SessionLocal()
    try:
        # google_linked se calcula de la tabla de cuentas vinculadas, no de
        # avatar_url -- avatar_url solo se completa cuando la cuenta se
        # CREO via Google, y queda vacio para una cuenta preexistente a la
        # que despues se le vincula Google (via /google/login?link=true o
        # directo por API), lo cual la hacia aparecer como "no vinculada"
        # aunque si lo estuviera.
        google_linked = (
            db.query(OAuthAccount)
            .filter(OAuthAccount.user_id == user.id, OAuthAccount.provider == AuthProviderEnum.google)
            .first()
            is not None
        )
    finally:
        db.close()

    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "google_linked": google_linked,
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
    y no expiró, marca la cuenta como verificada y la deja directamente
    logueada -- mismo mecanismo que el login con Google (access token en
    la URL, refresh en cookie httponly), reutilizado tal cual."""
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
        raise HTTPException(status_code=500, detail="No se pudo verificar la cuenta")
    finally:
        db.close()

    redirect = RedirectResponse(f"{FRONTEND_URL}/?access_token={access_token}")
    redirect.set_cookie(
        REFRESH_COOKIE, raw_refresh,
        httponly=True, samesite="lax", secure=False,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )
    return redirect


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


class ForgotPasswordIn(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordIn):
    """
    Siempre devuelve la misma respuesta, exista o no una cuenta con ese
    email -- evita que la respuesta del API permita confirmar qué emails
    están registrados. El mail solo se envía si la cuenta existe de
    verdad, y su contenido depende de si esa cuenta tiene contraseña
    propia o es exclusivamente de Google (caso en el que no tiene sentido
    ofrecer un reset, así que se le avisa en cambio cómo entrar).
    """
    generic_response = {
        "message": "Si existe una cuenta con ese email, te enviamos instrucciones."
    }

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == body.email).first()
        if user is None:
            return generic_response

        if user.password_hash is None:
            send_email(
                to_email=user.email,
                subject="Tu cuenta en Rave Radar AR usa Google",
                html_content=(
                    "<p>Pediste recuperar tu contraseña, pero tu cuenta no tiene una propia — "
                    "iniciaste sesión con Google. Entrá con el botón 'Continuar con Google' "
                    "en su lugar.</p>"
                ),
            )
            return generic_response

        raw_token, token_hash = generate_random_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_EXPIRE_HOURS),
        ))
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo procesar el pedido")
    finally:
        db.close()

    reset_url = f"{FRONTEND_URL}/reset-password?token={raw_token}"
    send_email(
        to_email=body.email,
        subject="Recuperá tu contraseña en Rave Radar AR",
        html_content=(
            f"<p>Pediste recuperar tu contraseña.</p>"
            f"<p><a href='{reset_url}'>Hacé click acá para elegir una nueva</a></p>"
            f"<p>Este link expira en {PASSWORD_RESET_EXPIRE_HOURS} horas. "
            f"Si no fuiste vos, podés ignorar este mail.</p>"
        ),
    )

    return generic_response


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password")
def reset_password(body: ResetPasswordIn):
    """
    Valida el token de recuperación y establece la nueva contraseña. Al
    resetear, se revocan TODAS las sesiones activas (refresh tokens) del
    usuario -- un reset suele responder a una sospecha de cuenta
    comprometida, así que no tendría sentido dejar vivas sesiones
    iniciadas antes del reset.
    """
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    token_hash = hash_token(body.token)
    db = SessionLocal()
    try:
        record = (
            db.query(PasswordResetToken)
            .filter(PasswordResetToken.token_hash == token_hash, PasswordResetToken.used_at.is_(None))
            .first()
        )
        if record is None or record.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="El link de recuperación es inválido o expiró")

        user = db.query(User).filter(User.id == record.user_id).first()
        user.password_hash = hash_password(body.new_password)
        record.used_at = datetime.now(timezone.utc)

        db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update(
            {"is_revoked": True}
        )

        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo restablecer la contraseña")
    finally:
        db.close()

    return {"message": "Contraseña actualizada. Ya podés iniciar sesión."}


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user)):
    """
    Cambia la contraseña de un usuario YA logueado (distinto del flujo de
    "olvidé mi contraseña", que no requiere sesión). Si la cuenta ya tiene
    contraseña, exige la actual antes de aceptar la nueva -- una sesión
    abierta en una compu no debería alcanzar para cambiar el acceso sin
    saber la contraseña vigente. Si la cuenta es solo-Google (sin
    contraseña todavía), no exige nada previo: es la forma de sumarle una
    contraseña por primera vez a una cuenta que hasta ahora solo entraba
    por Google.
    """
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")

    db = SessionLocal()
    try:
        db_user = db.query(User).filter(User.id == user.id).first()

        if db_user.password_hash is not None:
            if not body.current_password or not verify_password(body.current_password, db_user.password_hash):
                raise HTTPException(status_code=401, detail="Contraseña actual incorrecta")

        db_user.password_hash = hash_password(body.new_password)

        # Revoca todas las sesiones activas, igual que en el reset por mail
        # -- un cambio de contraseña debería invalidar sesiones viejas.
        db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update(
            {"is_revoked": True}
        )

        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="No se pudo cambiar la contraseña")
    finally:
        db.close()

    return {"message": "Contraseña actualizada."}