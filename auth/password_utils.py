"""
Utilidades de hasheo de contraseñas con bcrypt. A diferencia del refresh
token (jwt_utils.py), una contraseña SÍ la elige una persona y tiene baja
entropía comparativa -- por eso bcrypt, cuyo costo computacional
deliberado dificulta ataques de fuerza bruta o diccionario, a diferencia
del hash rápido (SHA-256) que alcanza para un token aleatorio de alta
entropía.
"""
import bcrypt


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), password_hash.encode())