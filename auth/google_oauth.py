"""
Todo lo especifico de hablar con los servidores de Google: armar la URL de
consentimiento, intercambiar el codigo de autorizacion por tokens, y
verificar la firma del id_token contra las claves publicas oficiales de
Google. Una vez que exchange_code_for_profile() termina, el resto del
sistema nunca vuelve a tocar la API de Google.
"""
import os
import secrets
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

load_dotenv()

GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
GOOGLE_CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
GOOGLE_REDIRECT_URI = os.environ["GOOGLE_REDIRECT_URI"]

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def build_login_url(state: str) -> str:
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code_for_profile(code: str) -> dict:
    """
    Intercambia el codigo de autorizacion por tokens de Google, verifica
    la firma del id_token contra las claves publicas oficiales de Google
    (nunca se confia en un id_token sin verificar su firma primero), y
    devuelve el perfil ya verificado: email, name, picture, sub (id unico
    de Google para este usuario).
    """
    response = requests.post(GOOGLE_TOKEN_URL, data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "code": code,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    })
    response.raise_for_status()
    tokens = response.json()

    idinfo = google_id_token.verify_oauth2_token(
        tokens["id_token"],
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )

    return {
        "sub": idinfo["sub"],
        "email": idinfo["email"],
        "name": idinfo.get("name"),
        "picture": idinfo.get("picture"),
    }