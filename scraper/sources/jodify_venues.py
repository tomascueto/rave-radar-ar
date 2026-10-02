# scraper/sources/jodify_venues.py
"""
Enriquece la tabla venues con datos completos de Jodify:
nombre, dirección, barrio y coordenadas (lat/lng).
"""

import json
import logging
import re
import time
import uuid
from pathlib import Path

import requests
from geoalchemy2.functions import ST_GeomFromText
from geoalchemy2.shape import to_shape
from requests.adapters import HTTPAdapter
from sqlalchemy.orm import Session
from urllib3.util.retry import Retry

from database.connection import SessionLocal
from database.models import Venue

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

EVENTS_FILE = Path("events_raw.json")
BASE_URL = "https://jodify.com.ar/event/{event_id}"
DELAY = 0.5
HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

COORD_CHANGE_TOLERANCE = 0.0001  # ~11 metros -- diferencias menores se tratan como ruido, no como cambio real


def _build_session() -> requests.Session:
    """Mismo mecanismo de reintentos que ya usa jodify.py para el scraper
    -- sin esto, una falla de red transitoria en medio de cientos de
    requests secuenciales deja ese venue sin coordenadas hasta la próxima
    corrida, en vez de resolverse sola en el momento."""
    session = requests.Session()
    session.headers.update(HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def extract_venue_from_html(html: str) -> dict | None:
    # Coordenadas con comillas: \"latitude\":\"valor\"
    # Coordenadas sin comillas: \"latitude\":valor
    lat = re.search(r'\\"latitude\\":\\"?([-\d.]+)\\"?', html)
    lng = re.search(r'\\"longitude\\":\\"?([-\d.]+)\\"?', html)
    name = re.search(r'\\"venues\\":\{\\"id\\":\\"[^"]+\\",\\"name\\":\\"([^"\\]+)\\"', html)
    neighborhood = re.search(r'\\"neighborhood\\":\\"([^"\\]+)\\"', html)
    address = re.search(r'\\"address\\":\\"([^"\\]+)\\"', html)

    if not name:
        return None

    return {
        "name": name.group(1).strip(),
        "neighborhood": neighborhood.group(1).strip() if neighborhood else None,
        "address": address.group(1).strip() if address else None,
        "latitude": lat.group(1) if lat else None,
        "longitude": lng.group(1) if lng else None,
    }


def update_venue(db: Session, data: dict, city_id: str | None) -> bool:
    """Devuelve True si las coordenadas del venue cambiaron de verdad en esta
    llamada (no solo se re-confirmaron) -- sirve para que enrich_venues()
    lleve la cuenta de cuántos cambios reales hubo en la corrida.

    Matchea por (nombre, city_id) -- NO por neighborhood -- a propósito:
    es la misma clave que ya usa get_or_create_venue() en load_jodify.py.
    neighborhood es texto libre extraído por regex de HTML, y puede variar
    entre la página de listado y la página individual de un evento para el
    MISMO venue real; city_id es el UUID estructurado que Jodify ya maneja
    internamente, mucho más estable. Usar claves distintas en cada script
    es lo que producía venues duplicados para un mismo lugar real -- uno
    viejo con precisión 'city' huérfano, y uno nuevo correcto sin que se
    enteraran el uno del otro.
    """
    name = data["name"].strip()
    neighborhood = data.get("neighborhood")
    city_uuid = uuid.UUID(city_id) if city_id else None

    query = db.query(Venue).filter(Venue.name == name)
    if city_uuid:
        query = query.filter(Venue.city_id == city_uuid)
    venue = query.first()

    if not venue:
        venue = Venue(id=uuid.uuid4(), name=name, city_id=city_uuid)
        db.add(venue)

    if neighborhood:
        venue.neighborhood = neighborhood
    if data.get("address"):
        venue.address = data["address"]

    coords_changed = False

    if data.get("latitude") and data.get("longitude"):
        try:
            new_lat = float(data["latitude"])
            new_lng = float(data["longitude"])
        except (ValueError, TypeError) as e:
            log.warning("Coordenadas inválidas para %s: %s", name, e)
            return False

        # Leer el valor ANTERIOR es best-effort, aislado del guardado real:
        # si este mismo venue ya fue tocado antes en esta misma corrida (dos
        # eventos, mismo lugar), lo que queda en memoria puede ser la
        # expresión SQL sin flushear de esa escritura previa, no un objeto
        # geometry real -- to_shape() falla ahí. Antes, esa falla quedaba
        # atrapada en el mismo except que la validación de datos nuevos, y
        # abortaba el guardado entero (incluido precision='exact') por un
        # problema que era solo de LECTURA, no de escritura. Ahora una falla
        # acá nunca frena la escritura de abajo -- en el peor caso se asume
        # "cambió" sin poder confirmarlo, nunca se pierde el dato nuevo.
        old_lat = old_lng = None
        if venue.coordinates is not None:
            try:
                old_point = to_shape(venue.coordinates)
                old_lat, old_lng = old_point.y, old_point.x
            except Exception:
                old_lat = old_lng = None

        coords_changed = (
            old_lat is None
            or abs(old_lat - new_lat) > COORD_CHANGE_TOLERANCE
            or abs(old_lng - new_lng) > COORD_CHANGE_TOLERANCE
        )

        if coords_changed and old_lat is not None:
            log.info(
                "📍 Coordenadas cambiaron para '%s' (precision previa: %s): "
                "(%.5f, %.5f) → (%.5f, %.5f)",
                name, venue.precision, old_lat, old_lng, new_lat, new_lng,
            )

        point_wkt = f"POINT({new_lng} {new_lat})"
        venue.coordinates = ST_GeomFromText(point_wkt, 4326)
        # Sin esto, un venue que mejora de 'city' (fallback) a coordenadas
        # reales de Jodify queda con datos exactos pero la ETIQUETA de
        # precision mintiendo -- seguiria mostrandose mas transparente en
        # el mapa, y seguiria contando como impreciso en la metrica de
        # RNF-06, aunque el dato real ya haya mejorado.
        venue.precision = "exact"

    return coords_changed


def enrich_venues() -> None:
    log.info("Leyendo %s…", EVENTS_FILE)
    with open(EVENTS_FILE, encoding="utf-8") as f:
        events = json.load(f)

    # Mapa event_id -> evento completo, no solo la lista de ids: hace falta
    # el city_id de cada evento (ya viene en events_raw.json, mismo campo
    # que usa load_jodify.py) para matchear venues con la MISMA clave que
    # ese script, no por neighborhood.
    events_by_id = {ev["id"]: ev for ev in events if ev.get("id")}
    log.info("%d eventos a procesar.", len(events_by_id))

    session = _build_session()
    db: Session = SessionLocal()

    updated = 0
    changed = 0
    skipped = 0
    errors = 0

    for i, (event_id, event) in enumerate(events_by_id.items(), 1):
        url = BASE_URL.format(event_id=event_id)
        try:
            r = session.get(url, timeout=15)
            if r.status_code != 200:
                log.warning("Evento %s: HTTP %d", event_id, r.status_code)
                errors += 1
                continue

            data = extract_venue_from_html(r.text)
            if not data:
                skipped += 1
                continue

            if update_venue(db, data, event.get("city_id")):
                changed += 1
            updated += 1

            if i % 20 == 0:
                db.commit()
                log.info("Progreso: %d/%d | actualizados: %d | cambios reales: %d | sin venue: %d | errores: %d",
                         i, len(events_by_id), updated, changed, skipped, errors)

        except requests.RequestException as e:
            log.warning("Error de red en evento %s (tras reintentos): %s", event_id, e)
            errors += 1

        time.sleep(DELAY)

    db.commit()
    log.info("✅ Finalizado — actualizados: %d | cambios reales: %d | sin venue: %d | errores: %d",
             updated, changed, skipped, errors)
    db.close()


if __name__ == "__main__":
    enrich_venues()