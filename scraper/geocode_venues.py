"""
Geocodifica venues sin coordenadas usando Nominatim (OpenStreetMap).

Estrategia de 2 pasos por venue:
  1. nombre + ciudad (limpiando nombres de ciudad que Nominatim no entiende bien)
  2. nombre + neighborhood

Guarda el resultado en venues.precision:
  - 'exact'   → Nominatim devolvió un resultado específico (no genérico)
  - 'city'    → fallback a las coordenadas del centro de la ciudad
  - 'unknown' → no se pudo geocodificar ni hacer fallback (sin city_id)

Solo procesa venues con coordinates IS NULL (o precision = 'unknown'),
para no volver a pegarle a Nominatim a los que ya están resueltos.

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
DELAY = 1.1  # segundos entre requests (Nominatim límite: 1/seg)

GENERIC_TYPES = {
    "country", "state", "province", "region",
    "city", "town", "village", "suburb", "neighbourhood",
}

# Nombres de ciudad que Nominatim no interpreta bien tal cual vienen de Jodify
CITY_NAME_MAP = {
    "CABA | GBA": "Buenos Aires",
    "Prov. de Buenos Aires": "Buenos Aires",
    "Santa Fe | Paraná": "Santa Fe",
    "Pinamar | Villa Gesell": "Pinamar",
    "Tierra Del Fuego": "Ushuaia",
    "Río Negro": "Bariloche",
}


def clean_city_name(name: str) -> str:
    return CITY_NAME_MAP.get(name, name)


def geocode(query: str) -> tuple[float, float, str] | None:
    """Consulta Nominatim y devuelve (lat, lng, type) o None si no hay resultado."""
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


def is_specific(result_type: str) -> bool:
    return result_type not in GENERIC_TYPES


def set_coordinates(venue: Venue, lat: float, lng: float, precision: str) -> None:
    point_wkt = f"POINT({lng} {lat})"
    venue.coordinates = ST_GeomFromText(point_wkt, 4326)
    venue.precision = precision


def geocode_venues() -> None:
    db: Session = SessionLocal()
    try:
        venues_sin_coords = (
            db.query(Venue)
            .filter(Venue.coordinates == None)
            .all()
        )

        total = len(venues_sin_coords)
        log.info("Venues sin coordenadas: %d", total)

        city_map = {str(c.id): c for c in db.query(City).all()}

        exact = 0
        city_fallback = 0
        unknown = 0

        for i, venue in enumerate(venues_sin_coords, 1):
            city = city_map.get(str(venue.city_id)) if venue.city_id else None
            city_name = clean_city_name(city.name) if city else None
            result = None

            # Paso 1: nombre + ciudad limpia
            if city_name:
                query1 = f"{venue.name}, {city_name}, Argentina"
                result = geocode(query1)
                time.sleep(DELAY)
                if result and not is_specific(result[2]):
                    result = None

            # Paso 2: nombre + neighborhood
            if not result and venue.neighborhood:
                query2 = f"{venue.name}, {venue.neighborhood}, Argentina"
                result = geocode(query2)
                time.sleep(DELAY)
                if result and not is_specific(result[2]):
                    result = None

            if result:
                lat, lng, result_type = result
                set_coordinates(venue, lat, lng, precision="exact")
                exact += 1
                log.debug("✅ %s → (%.4f, %.4f) [%s]", venue.name, lat, lng, result_type)
            elif city and city.latitude and city.longitude:
                set_coordinates(venue, city.latitude, city.longitude, precision="city")
                city_fallback += 1
                log.debug("🏙️  %s → fallback %s", venue.name, city.name)
            else:
                venue.precision = "unknown"
                unknown += 1

            if i % 20 == 0:
                db.commit()
                log.info("Progreso: %d/%d | exact: %d | city: %d | unknown: %d",
                         i, total, exact, city_fallback, unknown)

        db.commit()
        log.info("✅ Finalizado — exact: %d | city: %d | unknown: %d",
                 exact, city_fallback, unknown)

    except Exception as e:
        db.rollback()
        log.error("Error fatal: %s", e)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    geocode_venues()