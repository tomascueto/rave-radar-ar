"""
Envío de emails transaccionales vía SendGrid (verificación de cuenta,
recuperación de contraseña). Un único punto de entrada (send_email) que
el resto del sistema usa, sin que ningún otro módulo necesite conocer
detalles de la API de SendGrid.
"""
import os

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

load_dotenv()

SENDGRID_API_KEY = os.environ["SENDGRID_API_KEY"]
SENDGRID_FROM_EMAIL = os.environ["SENDGRID_FROM_EMAIL"]

_client = SendGridAPIClient(SENDGRID_API_KEY)


def send_email(to_email: str, subject: str, html_content: str) -> None:
    message = Mail(
        from_email=SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )
    _client.send(message)