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
from sqlalchemy.orm import Session

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


def update_venue(db: Session, data: dict) -> bool:
    name = data["name"].strip()
    neighborhood = data.get("neighborhood")

    query = db.query(Venue).filter(Venue.name == name)
    if neighborhood:
        query = query.filter(Venue.neighborhood == neighborhood)
    venue = query.first()

    if not venue:
        venue = Venue(id=uuid.uuid4(), name=name)
        db.add(venue)

    if neighborhood:
        venue.neighborhood = neighborhood
    if data.get("address"):
        venue.address = data["address"]

    if data.get("latitude") and data.get("longitude"):
        try:
            point_wkt = f"POINT({float(data['longitude'])} {float(data['latitude'])})"
            venue.coordinates = ST_GeomFromText(point_wkt, 4326)
        except (ValueError, TypeError) as e:
            log.warning("Coordenadas inválidas para %s: %s", name, e)

    return True


def enrich_venues() -> None:
    log.info("Leyendo %s…", EVENTS_FILE)
    with open(EVENTS_FILE, encoding="utf-8") as f:
        events = json.load(f)

    event_ids = [ev["id"] for ev in events if ev.get("id")]
    log.info("%d eventos a procesar.", len(event_ids))

    session = requests.Session()
    session.headers.update(HEADERS)
    db: Session = SessionLocal()

    updated = 0
    skipped = 0
    errors = 0

    for i, event_id in enumerate(event_ids, 1):
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

            update_venue(db, data)
            updated += 1

            if i % 20 == 0:
                db.commit()
                log.info("Progreso: %d/%d | actualizados: %d | sin venue: %d | errores: %d",
                         i, len(event_ids), updated, skipped, errors)

        except requests.RequestException as e:
            log.warning("Error de red en evento %s: %s", event_id, e)
            errors += 1

        time.sleep(DELAY)

    db.commit()
    log.info("✅ Finalizado — actualizados: %d | sin venue: %d | errores: %d",
             updated, skipped, errors)
    db.close()


if __name__ == "__main__":
    enrich_venues()