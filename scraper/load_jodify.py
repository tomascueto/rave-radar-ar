"""
Pipeline de carga: lee events_raw.json e inserta en PostgreSQL.
Estrategia:
  - Source:  upsert por nombre
  - Venue:   upsert por (nombre + city_id) — evita duplicados cross-ciudad
  - Event:   upsert por external_id
  - DJ:      upsert por nombre normalizado
  - Genre:   upsert por slug normalizado
"""

import json
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

import ftfy
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import (
    DJ, City, Event, EventDJ, EventGenre, Genre, Source, Venue,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

EVENTS_FILE = Path("events_raw.json")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def fix_encoding(text: str | None) -> str | None:
    """Repara texto con encoding roto: 'CÃ³rdoba' → 'Córdoba'."""
    if not text:
        return text
    return ftfy.fix_text(text)


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text


def parse_prices(price_list: list | None) -> tuple[Decimal | None, Decimal | None]:
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
    'Crobar - Palermo' → ('Crobar', 'Palermo')
    'Crobar'           → ('Crobar', None)
    """
    if not venue_str:
        return "Desconocido", None
    parts = venue_str.split(" - ", 1)
    name = fix_encoding(parts[0].strip())
    neighborhood = fix_encoding(parts[1].strip()) if len(parts) > 1 else None
    return name, neighborhood


# ─── Get or create helpers ────────────────────────────────────────────────────

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

    # Buscar por nombre + city_id para evitar duplicados cross-ciudad
    city_uuid = uuid.UUID(city_id) if city_id else None

    query = db.query(Venue).filter(Venue.name == name)
    if city_uuid:
        query = query.filter(Venue.city_id == city_uuid)
    venue = query.first()

    if not venue:
        venue = Venue(
            id=uuid.uuid4(),
            name=name,
            neighborhood=neighborhood,
            country="Argentina",
            city_id=city_uuid,
        )
        db.add(venue)
        db.flush()
    else:
        # Actualizar neighborhood si no lo tenía
        if neighborhood and not venue.neighborhood:
            venue.neighborhood = neighborhood

    return venue


def get_or_create_dj(db: Session, name: str, cache: dict) -> DJ:
    clean_name = fix_encoding(name.strip())
    key = clean_name.lower()
    if key in cache:
        return cache[key]
    dj = db.query(DJ).filter(DJ.name == clean_name).first()
    if not dj:
        dj = DJ(id=uuid.uuid4(), name=clean_name)
        db.add(dj)
        db.flush()
    cache[key] = dj
    return dj


def get_or_create_genre(db: Session, name: str, cache: dict) -> Genre:
    clean_name = fix_encoding(name.strip())
    slug = slugify(clean_name)
    if slug in cache:
        return cache[slug]
    genre = db.query(Genre).filter(Genre.slug == slug).first()
    if not genre:
        genre = Genre(id=uuid.uuid4(), name=clean_name, slug=slug)
        db.add(genre)
        db.flush()
    cache[slug] = genre
    return genre


# ─── Pipeline principal ───────────────────────────────────────────────────────

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

                city_id = raw.get("city_id")

                # Venue
                venue = get_or_create_venue(db, raw.get("venue"), city_id)

                # Precios
                min_price, max_price = parse_prices(raw.get("price"))

                # event_type
                sunset_after = (raw.get("sunset_after") or "").upper()
                if sunset_after == "SUNSET":
                    event_type = "sunset"
                elif sunset_after == "AFTER":
                    event_type = "after"
                else:
                    event_type = "party"

                # image
                image = raw.get("image") or {}
                flyer_url = (
                    image.get("flyer")
                    or image.get("image_url")
                    or image.get("banner")
                )

                # Buscar evento existente
                event = db.query(Event).filter_by(external_id=external_id).first()

                if event:
                    event.name = fix_encoding(raw["name"])
                    event.min_price = min_price
                    event.max_price = max_price
                    event.is_active = raw.get("is_active", True)
                    event.flyer_url = flyer_url
                    event.description = fix_encoding(raw.get("description"))
                    event.venue_id = venue.id
                    event.city_id = uuid.UUID(city_id) if city_id else None
                    updated += 1
                else:
                    event = Event(
                        id=uuid.uuid4(),
                        external_id=external_id,
                        source_id=source.id,
                        venue_id=venue.id,
                        city_id=uuid.UUID(city_id) if city_id else None,
                        name=fix_encoding(raw["name"]),
                        description=fix_encoding(raw.get("description")),
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

                # DJs
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

                # Géneros
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


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    log.info("Leyendo %s…", EVENTS_FILE)
    with open(EVENTS_FILE, encoding="utf-8") as f:
        events = json.load(f)
    log.info("%d eventos a procesar.", len(events))
    load_events(events)


if __name__ == "__main__":
    main()