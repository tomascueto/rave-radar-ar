# scraper/deactivate_past_events.py
"""
Desactiva eventos cuya fecha ya pasó.

Por qué hace falta un paso propio para esto: load_jodify.py toma is_active
desde el JSON de cada evento tal como lo manda Jodify -- pero un evento que
ya pasó probablemente deja de aparecer en el listado de /events (en vez de
aparecer con is_active=false), así que nunca vuelve a estar en
events_raw.json y el loader nunca lo vuelve a tocar. Sin este paso,
quedaría is_active=true en nuestra base para siempre, sin importar cuánto
tiempo pase.

En vez de depender de adivinar ese comportamiento de Jodify, la regla es
propia y determinística: cualquier evento cuyo COALESCE(date_to, date_from)
ya pasó se desactiva, lo traiga o no la próxima scrapeada. Se usa
COALESCE en vez de date_from solo para no desactivar de más un evento que
ya empezó pero todavía no terminó (ej: arranca 23:00, termina 07:00 del
día siguiente) -- ahí date_from ya pasó pero el evento sigue en curso.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import func

from database.connection import SessionLocal
from database.models import Event

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def deactivate_past_events() -> int:
    """Devuelve la cantidad de eventos desactivados en esta corrida."""
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        end_marker = func.coalesce(Event.date_to, Event.date_from)

        count = (
            db.query(Event)
            .filter(Event.is_active == True, end_marker < now)
            .update({"is_active": False}, synchronize_session=False)
        )
        db.commit()
        log.info("Eventos desactivados por fecha ya pasada: %d", count)
        return count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    deactivate_past_events()