"""
Geocodifica venues sin coordenadas usando Nominatim (OpenStreetMap).

Estrategia por venue:
  1. Query: "{name}, {neighborhood}, {ciudad}, Argentina"
  2. Si Nominatim devuelve resultado específico (type != country/state) → usar
  3. Si no → fallback a coordenadas de la ciudad del venue
  4. Si no hay ciudad → queda sin coordenadas

Límite Nominatim: 1 request/segundo.
"""

import logging
import time

import requests
from geoalchemy2.functions import ST_GeomFromText
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import City, Venue

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "RaveRadarAR/1.0 (proyecto universitario UNS)"
}
DELAY = 1.1

GENERIC_TYPES = {
    "country", "state", "province", "region",
    "city", "town", "village", "suburb", "neighbourhood",
}


def geocode(query: str) -> tuple[float, float, str] | None:
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "countrycodes": "ar",
    }
    try:
        r = requests.get(
            NOMINATIM_URL,
            params=params,
            headers=NOMINATIM_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        results = r.json()
        if not results:
            return None
        result = results[0]
        return float(result["lat"]), float(result["lon"]), result.get("type", "")
    except Exception as e:
        log.warning("Error en Nominatim para query '%s': %s", query, e)
        return None


def set_coordinates(venue: Venue, lat: float, lng: float) -> None:
    point_wkt = f"POINT({lng} {lat})"
    venue.coordinates = ST_GeomFromText(point_wkt, 4326)


def geocode_venues() -> None:
    db: Session = SessionLocal()
    try:
        venues_sin_coords = (
            db.query(Venue)
            .filter(Venue.coordinates == None)
            .all()
        )

        # DEBUG: solo primeras 20
        venues_sin_coords = venues_sin_coords[:20]

        total = len(venues_sin_coords)
        log.info("Venues sin coordenadas: %d", total)

        # Precargamos city_id → city para no hacer queries en el loop
        city_map = {str(c.id): c for c in db.query(City).all()}

        geocoded = 0
        fallback = 0
        sin_coords = 0

        for i, venue in enumerate(venues_sin_coords, 1):
            # Construir query con nombre + barrio + ciudad + país
            parts = [venue.name]
            if venue.neighborhood:
                parts.append(venue.neighborhood)
            city = city_map.get(str(venue.city_id)) if venue.city_id else None
            if city:
                parts.append(city.name)
            parts.append("Argentina")
            query = ", ".join(parts)

            log.info("Query [%d/%d]: %s", i, total, query)
            result = geocode(query)

            if result:
                lat, lng, result_type = result
                log.info("  → type: %s | (%.4f, %.4f)", result_type, lat, lng)
                if result_type not in GENERIC_TYPES:
                    set_coordinates(venue, lat, lng)
                    geocoded += 1
                else:
                    log.info("  → genérico, usando fallback")
                    result = None

            if not result:
                if city and city.latitude and city.longitude:
                    set_coordinates(venue, city.latitude, city.longitude)
                    fallback += 1
                    log.info("  → fallback ciudad: %s", city.name)
                else:
                    sin_coords += 1
                    log.info("  → sin coordenadas")

            time.sleep(DELAY)

        db.commit()
        log.info("✅ Finalizado — geocoded: %d | fallback ciudad: %d | sin coordenadas: %d",
                 geocoded, fallback, sin_coords)

    except Exception as e:
        db.rollback()
        log.error("Error fatal: %s", e)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    geocode_venues()