"""
Segunda pasada de geocodificación para venues con precision='city'.

Debido al límite del tier gratuito de Gemini (20 requests/día para
gemini-2.5-flash), agrupamos varios venues por llamada en vez de consultar
uno por uno. Con lotes de ~10 venues, 124 candidatos entran en ~13 llamadas,
bien por debajo del límite diario.

Pipeline por lote:
  1. Gemini (2.5-flash + google_search) busca la dirección física de cada
     venue del lote — nunca le pedimos coordenadas directamente, para evitar
     que el modelo "calcule" o alucine un lat/lng.
  2. Por cada dirección encontrada, Nominatim la geocodifica como búsqueda
     estructurada (mucho más confiable con una dirección real que con un
     nombre de fantasía).
  3. Se valida que el resultado quede a menos de MAX_DISTANCE_KM del centro
     de la ciudad del venue — así se descartan coincidencias de nombre de
     calle en otra provincia.
  4. Solo si los 3 pasos tienen éxito, se actualiza el venue y se marca
     precision='llm_search'. Cualquier falla deja el venue intacto con su
     fallback de ciudad — nada se pierde, se puede reintentar otro día.

Requiere GEMINI_API_KEY en el .env.
"""

import json
import logging
import math
import time

from dotenv import load_dotenv
from geoalchemy2.functions import ST_GeomFromText
from google import genai
from google.genai import types
import requests
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import City, Venue

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

client = genai.Client()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "RaveRadarAR/1.0 (proyecto universitario UNS)"
}
GEMINI_DELAY = 3.0       # segundos entre llamadas a Gemini (son muchas menos ahora)
NOMINATIM_DELAY = 1.1    # segundos entre llamadas a Nominatim
MAX_DISTANCE_KM = 150
BATCH_SIZE = 10          # venues por llamada a Gemini


# ─── Gemini: buscar direcciones en lote ──────────────────────────────────────

def find_addresses_batch(venues_batch: list[tuple[str, str, str]]) -> dict[str, str | None]:
    """
    venues_batch: lista de (venue_id, venue_name, city_name)
    Devuelve: dict venue_id -> address_found (o None si no se encontró)
    """
    items_text = "\n".join(
        f'{i+1}. id="{vid}" | lugar="{name}" | ciudad="{city}"'
        for i, (vid, name, city) in enumerate(venues_batch)
    )

    prompt = f"""Buscá en internet la dirección física exacta de cada uno de los siguientes lugares. Son venues de fiestas de música electrónica en Argentina.

{items_text}

Para cada uno, buscá individualmente y encontrá su dirección real (calle y altura, o ruta y km). Si no encontrás alguno con certeza, poné su dirección como null — no inventes.

Respondé ÚNICAMENTE con un JSON array, sin texto adicional, con este formato exacto:
[
  {{"id": "id_del_lugar", "address_found": "dirección exacta" o null}},
  ...
]

Incluí una entrada por cada uno de los {len(venues_batch)} lugares listados, en el mismo orden."""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        results = json.loads(text.strip())

        out: dict[str, str | None] = {}
        for item in results:
            vid = item.get("id")
            addr = item.get("address_found")
            if addr and str(addr).lower() != "null":
                out[vid] = addr
            else:
                out[vid] = None
        return out
    except Exception as e:
        log.warning("Error consultando Gemini en lote: %s", e)
        # Si el lote entero falla, no perdemos nada: se reintentan la próxima corrida
        return {}


# ─── Nominatim: geocodificar la dirección encontrada ─────────────────────────

def geocode_address(address: str, city_name: str) -> tuple[float, float] | None:
    """
    La dirección suele venir con ciudad/país ya incluidos (porque el LLM la
    buscó así), así que solo agregamos el nombre de ciudad si claramente no
    está presente — evita duplicar "Río Negro, Argentina, Río Negro, Argentina".
    """
    query = address if city_name.lower() in address.lower() else f"{address}, {city_name}, Argentina"
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
        return float(result["lat"]), float(result["lon"])
    except Exception as e:
        log.warning("Error en Nominatim para dirección '%s': %s", address, e)
        return None


# ─── Validación de distancia (haversine) ─────────────────────────────────────

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371  # radio de la Tierra en km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ─── Pipeline principal ───────────────────────────────────────────────────────

def set_coordinates(venue: Venue, lat: float, lng: float) -> None:
    point_wkt = f"POINT({lng} {lat})"
    venue.coordinates = ST_GeomFromText(point_wkt, 4326)
    venue.precision = "llm_search"


def chunked(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def run(batch_size: int = BATCH_SIZE) -> None:
    db: Session = SessionLocal()
    try:
        city_map = {str(c.id): c for c in db.query(City).all()}

        candidatos = db.query(Venue).filter(Venue.precision == "city").all()
        total = len(candidatos)
        log.info("Venues con precision='city' a re-intentar: %d", total)

        # Armamos (id, nombre, ciudad) para cada candidato con ciudad conocida
        items: list[tuple[str, str, str]] = []
        venue_by_id: dict[str, Venue] = {}
        for v in candidatos:
            city = city_map.get(str(v.city_id)) if v.city_id else None
            if not city:
                continue
            items.append((str(v.id), v.name, city.name))
            venue_by_id[str(v.id)] = v

        n_batches = (len(items) + batch_size - 1) // batch_size
        log.info("Se procesarán en lotes de %d (~%d llamadas a Gemini)", batch_size, n_batches)

        mejorados = 0
        sin_direccion = 0
        direccion_sin_geocodificar = 0
        fuera_de_rango = 0
        lote_fallido = 0

        for batch_num, batch in enumerate(chunked(items, batch_size), 1):
            log.info("Lote %d/%d: consultando %d venues a Gemini...", batch_num, n_batches, len(batch))
            addresses = find_addresses_batch(batch)
            time.sleep(GEMINI_DELAY)

            if not addresses:
                lote_fallido += len(batch)
                log.warning("Lote %d falló por completo (quota u otro error), se reintenta otro día", batch_num)
                continue

            for vid, venue_name, city_name in batch:
                venue = venue_by_id[vid]
                address = addresses.get(vid)

                if not address:
                    sin_direccion += 1
                    log.debug("⚠️  %s → Gemini no encontró dirección", venue_name)
                    continue

                coords = geocode_address(address, city_name)
                time.sleep(NOMINATIM_DELAY)

                if not coords:
                    direccion_sin_geocodificar += 1
                    log.debug("⚠️  %s → dirección '%s' no geocodificable", venue_name, address)
                    continue

                lat, lng = coords
                city = city_map.get(str(venue.city_id))
                if city and city.latitude and city.longitude:
                    dist = haversine_km(lat, lng, city.latitude, city.longitude)
                    if dist > MAX_DISTANCE_KM:
                        fuera_de_rango += 1
                        log.debug("⚠️  %s → resultado a %.0f km de %s, descartado", venue_name, dist, city_name)
                        continue

                set_coordinates(venue, lat, lng)
                mejorados += 1
                log.info("✅ %s → (%.4f, %.4f) | dirección: %s", venue_name, lat, lng, address)

            db.commit()
            log.info(
                "Progreso tras lote %d/%d: mejorados=%d | sin dirección=%d | "
                "no geocodificable=%d | fuera de rango=%d | lotes fallidos(venues)=%d",
                batch_num, n_batches, mejorados, sin_direccion,
                direccion_sin_geocodificar, fuera_de_rango, lote_fallido,
            )

        db.commit()
        log.info(
            "✅ Finalizado — mejorados: %d | sin dirección: %d | "
            "no geocodificable: %d | fuera de rango: %d | venues en lotes fallidos: %d",
            mejorados, sin_direccion, direccion_sin_geocodificar,
            fuera_de_rango, lote_fallido,
        )

    except Exception as e:
        db.rollback()
        log.error("Error fatal: %s", e)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()