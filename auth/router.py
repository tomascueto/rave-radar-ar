"""
Endpoints del flujo de login con Google. Una vez logueado, el resto del
sistema (incluido el chat) nunca vuelve a hablar con Google -- solo con
los JWT propios emitidos aca.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import SQLAlchemyError

from auth.dependencies import get_current_user
from auth.google_oauth import build_login_url, exchange_code_for_profile, generate_state
from auth.jwt_utils import (
    create_access_token, generate_refresh_token, hash_refresh_token,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from database.connection import SessionLocal
from database.models import AuthProviderEnum, OAuthAccount, RefreshToken, User

router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL = "http://localhost:5173"

STATE_COOKIE = "oauth_state"
REFRESH_COOKIE = "refresh_token"


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