"""
Utilidades para emitir y verificar los JSON Web Tokens (JWT) propios del
sistema -- no confundir con el id_token que emite Google, que se verifica
por separado en google_oauth.py. Una vez que confirmamos la identidad del
usuario via Google, el resto del sistema no vuelve a hablar con Google en
absoluto: opera exclusivamente con estos tokens propios.
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"]
JWT_ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30


def create_access_token(user_id) -> str:
    """Token de corta duracion, el que el frontend manda en cada request
    (header Authorization: Bearer <token>)."""
    payload = {
        "sub": str(user_id),
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> str:
    """Verifica firma y expiracion; devuelve el user_id (sub) si es valido.
    Lanza jwt.InvalidTokenError (o subclases, como ExpiredSignatureError)
    si el token es invalido -- el llamador decide como responder."""
    payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Token no es de tipo access")
    return payload["sub"]


def generate_refresh_token() -> tuple[str, str]:
    """Genera un refresh token de alta entropia. Devuelve (token_crudo,
    hash_para_guardar) -- el crudo se manda al cliente UNA vez (en la
    cookie), el hash es lo unico que se persiste en la base. Al ser un
    valor aleatorio de ~384 bits (no una contrasena elegida por un
    humano), alcanza con un hash rapido (SHA-256) -- el hash lento tipo
    bcrypt esta pensado para proteger contra fuerza bruta sobre valores de
    baja entropia, que no es el caso aca."""
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, token_hash


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()