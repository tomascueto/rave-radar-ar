"""
Envío de emails transaccionales vía SendGrid (verificación de cuenta,
recuperación de contraseña). Un único punto de entrada (send_email) que
el resto del sistema usa, sin que ningún otro módulo necesite conocer
detalles de la API de SendGrid.

Los templates viven acá (render_email) en vez de en cada llamado de
auth/router.py -- maquetados con tablas HTML y estilos inline en cada
elemento, no una hoja de estilos aparte ni clases de utilidad: muchos
clientes de mail (Outlook de escritorio en particular, que renderiza con
el motor de Word) no soportan flexbox/grid ni <style> confiable. Paleta
y tipografía tomadas de "El Mapa de Confianza" (ver DESIGN.md) -- el
mundo al que pertenece AuthModal, de donde salen estos tres flujos --
nunca la del mundo "Flyer Xerografiado" (sin Anton/Courier Prime, sin
fondo oscuro).
"""
import os

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

load_dotenv()

SENDGRID_API_KEY = os.environ["SENDGRID_API_KEY"]
SENDGRID_FROM_EMAIL = os.environ["SENDGRID_FROM_EMAIL"]

_client = SendGridAPIClient(SENDGRID_API_KEY)

_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"


def render_email(heading: str, paragraphs: list[str], cta_url: str | None = None, cta_label: str | None = None) -> str:
    """
    Arma el HTML completo de un email transaccional a partir de un titulo,
    parrafos de texto plano, y un boton opcional -- los tres templates de
    auth/router.py (verificacion, aviso de cuenta-solo-Google, reset de
    contraseña) llaman a esto en vez de armar su propio HTML.

    Estructura bulletproof para Outlook: una tabla fantasma con ancho fijo
    (600px) encerrada en comentarios condicionales [if mso] es lo unico
    que efectivamente fuerza un ancho maximo ahi -- max-width en CSS lo
    ignora por completo, a diferencia del resto de los clientes (Gmail,
    Apple Mail, etc.) que si lo respetan. El boton (cuando existe) es una
    <td> con bgcolor + border-radius: se ve como pildora violeta en casi
    todos lados, y como rectangulo violeta (funcional, solo sin el
    redondeo) en Outlook de escritorio -- una degradacion aceptada, no un
    bug, ya que Outlook tampoco soporta border-radius en absoluto.
    """
    body_html = "".join(
        f'<p style="margin:0 0 16px 0;font-family:{_FONT_STACK};'
        f'font-size:14px;line-height:1.6;color:#1E293B;">{p}</p>'
        for p in paragraphs
    )

    cta_html = ""
    if cta_url and cta_label:
        cta_html = f'''
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
          <tr>
            <td bgcolor="#7C3AED" style="border-radius:9999px;">
              <a href="{cta_url}" target="_blank" style="display:inline-block;padding:12px 32px;
                font-family:{_FONT_STACK};font-size:14px;font-weight:700;color:#FFFFFF;
                text-decoration:none;border-radius:9999px;">{cta_label}</a>
            </td>
          </tr>
        </table>
        '''

    return f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>Rave Radar AR</title>
<!--[if mso]>
<style>table {{ border-collapse: collapse; }}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!--[if mso]>
        <table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>
        <![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;">
          <tr>
            <td style="background-color:#7C3AED;height:4px;line-height:4px;font-size:0;border-radius:16px 16px 0 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 32px 28px 32px;">
              <p style="margin:0 0 20px 0;font-family:{_FONT_STACK};font-size:12px;font-weight:700;
                letter-spacing:0.06em;text-transform:uppercase;color:#7C3AED;">Rave Radar AR</p>
              <h1 style="margin:0 0 16px 0;font-family:{_FONT_STACK};font-size:20px;font-weight:600;
                line-height:1.3;color:#1E293B;">{heading}</h1>
              {body_html}
              {cta_html}
            </td>
          </tr>
        </table>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

        <p style="margin:20px 0 0 0;font-family:{_FONT_STACK};font-size:12px;color:#94A3B8;">
          Rave Radar AR &middot; Mapa en vivo + recomendaci&oacute;n por IA
        </p>
      </td>
    </tr>
  </table>
</body>
</html>'''


def send_email(to_email: str, subject: str, html_content: str) -> None:
    message = Mail(
        from_email=SENDGRID_FROM_EMAIL,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )
    _client.send(message)
