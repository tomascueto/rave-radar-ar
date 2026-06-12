# scraper/load_jodify.py
"""
Pipeline de carga: lee events_raw.json e inserta en PostgreSQL.
Estrategia:
  - Source:  upsert por nombre
  - Venue:   upsert por (name, city) — sin coordenadas por ahora
  - Event:   upsert por external_id
  - DJ:      upsert por nombre (normalizado)
  - Genre:   upsert por slug (normalizado)
"""

import json
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from database.connection import SessionLocal, engine
from database.models import (
    DJ, Base, Event, EventDJ, EventGenre, Genre, Source, Venue,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

EVENTS_FILE = Path("events_raw.json")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """'Progressive House' → 'progressive-house'"""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text


def parse_prices(price_list: list | None) -> tuple[Decimal | None, Decimal | None]:
    """Devuelve (min_price, max_price) del array de precios de Jodify."""
    if not price_list:
        return None, None
    prices = []
    for item in price_list:
        try:
            val = Decimal(str(item.get("price", 0)))
            if val > 0:
                prices.append(val)
        except InvalidOperation:
            continue
    if not prices:
        return None, None
    return min(prices), max(prices)


def parse_venue_parts(venue_str: str | None) -> tuple[str, str | None]:
    """
    'Crobar - Palermo'  → ('Crobar', 'Palermo')
    'Crobar'            → ('Crobar', None)
    """
    if not venue_str:
        return "Desconocido", None
    parts = venue_str.split(" - ", 1)
    name = parts[0].strip()
    neighborhood = parts[1].strip() if len(parts) > 1 else None
    return name, neighborhood


def get_or_create_source(db: Session) -> Source:
    source = db.query(Source).filter_by(name="jodify").first()
    if not source:
        source = Source(
            id=uuid.uuid4(),
            name="jodify",
            base_url="https://jodify.com.ar",
            is_active=True,
        )
        db.add(source)
        db.flush()
        log.info("Source 'jodify' creada.")
    return source


def get_or_create_venue(db: Session, venue_str: str | None, city_id: str | None) -> Venue:
    name, neighborhood = parse_venue_parts(venue_str)

    # Buscamos por nombre + barrio
    query = db.query(Venue).filter(Venue.name == name)
    if neighborhood:
        query = query.filter(Venue.neighborhood == neighborhood)
    venue = query.first()

    if not venue:
        venue = Venue(
            id=uuid.uuid4(),
            name=name,
            neighborhood=neighborhood,
            country="Argentina",
        )
        db.add(venue)
        db.flush()

    return venue


def get_or_create_dj(db: Session, name: str, cache: dict) -> DJ:
    key = name.strip().lower()
    if key in cache:
        return cache[key]
    dj = db.query(DJ).filter(DJ.name == name.strip()).first()
    if not dj:
        dj = DJ(id=uuid.uuid4(), name=name.strip())
        db.add(dj)
        db.flush()
    cache[key] = dj
    return dj


def get_or_create_genre(db: Session, name: str, cache: dict) -> Genre:
    slug = slugify(name)
    if slug in cache:
        return cache[slug]
    genre = db.query(Genre).filter(Genre.slug == slug).first()
    if not genre:
        genre = Genre(id=uuid.uuid4(), name=name.strip(), slug=slug)
        db.add(genre)
        db.flush()
    cache[slug] = genre
    return genre


# ─── Pipeline principal ──────────────────────────────────────────────────────

def load_events(events: list[dict]) -> None:
    db: Session = SessionLocal()
    try:
        source = get_or_create_source(db)
        dj_cache: dict = {}
        genre_cache: dict = {}

        inserted = 0
        updated = 0
        errors = 0

        for raw in events:
            try:
                external_id = raw.get("id")
                if not external_id:
                    continue

                # Venue
                venue = get_or_create_venue(db, raw.get("venue"), raw.get("city_id"))

                # Precios
                min_price, max_price = parse_prices(raw.get("price"))

                # event_type
                sunset_after = (raw.get("sunset_after") or "").upper()
                if sunset_after == "SUNSET":
                    event_type = "sunset"
                elif sunset_after == "AFTER":
                    event_type = "after"
                elif raw.get("coffee_rave"):
                    event_type = "party"
                else:
                    event_type = "party"

                # image_url
                image = raw.get("image") or {}
                flyer_url = (
                    image.get("flyer")
                    or image.get("image_url")
                    or image.get("banner")
                )

                # Buscar evento existente por external_id
                event = db.query(Event).filter_by(external_id=external_id).first()

                if event:
                    # Actualizar campos que pueden cambiar
                    event.name = raw["name"]
                    event.min_price = min_price
                    event.max_price = max_price
                    event.is_active = raw.get("is_active", True)
                    event.flyer_url = flyer_url
                    event.description = raw.get("description")
                    updated += 1
                else:
                    event = Event(
                        id=uuid.uuid4(),
                        external_id=external_id,
                        source_id=source.id,
                        venue_id=venue.id,
                        name=raw["name"],
                        description=raw.get("description"),
                        date_from=raw["date_from"],
                        date_to=raw.get("date_to"),
                        min_price=min_price,
                        max_price=max_price,
                        currency="ARS",
                        ticket_url=raw.get("ticket_link"),
                        flyer_url=flyer_url,
                        event_type=event_type,
                        is_active=raw.get("is_active", True),
                        is_enriched=False,
                    )
                    db.add(event)
                    db.flush()
                    inserted += 1

                # DJs — borramos los existentes y re-insertamos
                db.query(EventDJ).filter_by(event_id=event.id).delete()
                for i, dj_data in enumerate(raw.get("djs") or []):
                    dj_name = dj_data.get("name", "").strip()
                    if not dj_name:
                        continue
                    dj = get_or_create_dj(db, dj_name, dj_cache)
                    db.add(EventDJ(
                        event_id=event.id,
                        dj_id=dj.id,
                        is_headliner=(i == 0),
                        order=i,
                    ))

                # Géneros — borramos los existentes y re-insertamos
                db.query(EventGenre).filter_by(event_id=event.id).delete()
                for i, type_data in enumerate(raw.get("types") or []):
                    genre_name = type_data.get("name", "").strip()
                    if not genre_name:
                        continue
                    genre = get_or_create_genre(db, genre_name, genre_cache)
                    db.add(EventGenre(
                        event_id=event.id,
                        genre_id=genre.id,
                        is_primary=(i == 0),
                    ))

            except Exception as exc:
                log.warning("Error procesando evento %s: %s", raw.get("id"), exc)
                db.rollback()
                errors += 1
                # Re-obtenemos source después del rollback
                source = get_or_create_source(db)
                continue

        db.commit()
        log.info("✅ Carga finalizada — insertados: %d | actualizados: %d | errores: %d",
                 inserted, updated, errors)

    except Exception as exc:
        db.rollback()
        log.error("Error fatal: %s", exc)
        raise
    finally:
        db.close()


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    log.info("Leyendo %s…", EVENTS_FILE)
    with open(EVENTS_FILE, encoding="utf-8") as f:
        events = json.load(f)
    log.info("%d eventos a procesar.", len(events))
    load_events(events)


if __name__ == "__main__":
    main()