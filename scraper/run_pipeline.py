"""
Corre el pipeline completo de datos en un solo comando: scrapea Jodify,
carga los eventos a Postgres, desactiva los que ya pasaron de fecha,
enriquece los venues con coordenadas reales, e indexa todo en Qdrant para
que el chat pueda encontrarlo por búsqueda semántica.

No reemplaza a los cinco scripts individuales -- los reutiliza tal cual,
llamando a sus funciones en orden. Si en algún momento hace falta correr
solo uno (por ejemplo, re-enriquecer venues sin volver a scrapear, o
reindexar Qdrant después de un cambio manual en Postgres), los scripts
originales se siguen usando por separado.

Sobre "0 eventos": el scraper puede devolver una lista vacía por dos
motivos muy distintos -- genuinamente no hay eventos nuevos (raro, pero
posible), o el NEXT_ACTION_TOKEN venció y Jodify ya no responde con el
formato esperado. Sin ninguna señal explícita, las dos se ven idénticas
desde afuera. Corriendo esto desatendido una vez por día, tratamos "0
eventos" como una falla real y avisamos por mail -- preferible una alerta
de más (se revisa y se descarta en un minuto) a un mes entero sin darse
cuenta de que la app dejó de recibir eventos nuevos.

Uso:
    python -m scraper.run_pipeline
"""
from __future__ import annotations

import logging
import sys
import traceback

from auth.email_utils import send_email
from database.connection import SessionLocal
from database.models import User
from scraper.deactivate_past_events import deactivate_past_events
from scraper.index_events_qdrant import index_events
from scraper.load_jodify import load_events
from scraper.sources.jodify import fetch_all_events, save_results
from scraper.sources.jodify_venues import enrich_venues

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def _notify_admins(subject: str, html_content: str) -> None:
    """Avisa a todos los usuarios admin -- reusa is_admin en vez de un
    email fijo en el código, así que alcanza con dar de alta un admin más
    para que también reciba las alertas, sin tocar este archivo."""
    db = SessionLocal()
    try:
        admins = db.query(User).filter_by(is_admin=True).all()
    finally:
        db.close()

    if not admins:
        log.warning("No hay ningún usuario admin a quien avisar -- revisar manualmente.")
        return

    for admin in admins:
        try:
            send_email(to_email=admin.email, subject=subject, html_content=html_content)
        except Exception:
            log.error("No se pudo enviar el mail de alerta a %s", admin.email)


def main() -> None:
    try:
        log.info("=== Paso 1/5: scrapeando Jodify ===")
        events = fetch_all_events()
        save_results(events)

        if not events:
            msg = (
                "El scraper de Jodify devolvió 0 eventos. Puede ser que "
                "genuinamente no haya eventos nuevos, pero también es el "
                "síntoma de un NEXT_ACTION_TOKEN vencido -- conviene "
                "revisarlo a mano antes de asumir que está todo bien."
            )
            fix_steps = (
                "<p><b>Cómo renovar el token, si es eso:</b></p>"
                "<ol>"
                "<li>Entrá a jodify.com.ar/events en el navegador.</li>"
                "<li>Abrí las DevTools (F12) → pestaña Network → filtro Fetch/XHR.</li>"
                "<li>Hacé scroll en la página para disparar un pedido nuevo.</li>"
                "<li>Buscá el request POST a /events, y copiá el valor del header <code>next-action</code>.</li>"
                "<li>Reemplazá NEXT_ACTION_TOKEN en scraper/sources/jodify.py con ese valor.</li>"
                "</ol>"
            )
            log.error(msg)
            _notify_admins(
                subject="⚠️ Rave Radar AR: el scraper devolvió 0 eventos",
                html_content=f"<p>{msg}</p>{fix_steps}",
            )
            sys.exit(1)

        log.info("=== Paso 2/5: cargando %d eventos a Postgres ===", len(events))
        load_events(events)

        log.info("=== Paso 3/5: desactivando eventos con fecha ya pasada ===")
        deactivate_past_events()

        log.info("=== Paso 4/5: enriqueciendo venues con coordenadas reales ===")
        enrich_venues()

        log.info("=== Paso 5/5: indexando eventos en Qdrant ===")
        index_events()

        log.info("=== Pipeline completo ===")

    except Exception:
        error_detail = traceback.format_exc()
        log.error("Pipeline falló con una excepción:\n%s", error_detail)
        _notify_admins(
            subject="🔴 Rave Radar AR: el pipeline de datos falló",
            html_content=f"<p>El pipeline diario falló con este error:</p><pre>{error_detail}</pre>",
        )
        sys.exit(1)


if __name__ == "__main__":
    main()