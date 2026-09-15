"""
Dependencia de FastAPI para proteger endpoints: extrae y verifica el JWT
del header Authorization, y devuelve el User correspondiente. Cualquier
endpoint que dependa de esto (Depends(get_current_user)) rechaza
automaticamente requests sin sesion valida, sin que cada endpoint tenga
que repetir esa logica.
"""
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from auth.jwt_utils import decode_access_token
from database.connection import SessionLocal
from database.models import User

_bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")

    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión inválida")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado")

    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """
    Igual que get_current_user, pero nunca rechaza la request -- devuelve
    None si no hay token o es invalido, en vez de un 401. Para endpoints
    como /api/chat, donde la sesion es opcional: personaliza si hay
    usuario logueado, funciona igual sin exigirlo.
    """
    if credentials is None:
        return None
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError:
        return None
    return db.query(User).filter(User.id == user_id, User.is_active == True).first()