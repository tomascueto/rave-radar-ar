"""
Endpoint minimo de FastAPI para el mapa: devuelve eventos activos con
coordenadas reales, listos para pintar como pines.

Este es el primer punto donde el sistema serializa datos hacia afuera en
JSON -- hasta ahora todo el trabajo del proyecto consulto la base de datos
con scripts sueltos, nunca a traves de una capa HTTP. Tres tipos de dato
necesitan conversion explicita, que Postgres/SQLAlchemy no hacen solos:
  - UUID          -> string
  - datetime      -> ISO 8601 string
  - Geometry(PostGIS) -> (lat, lng) numericos

Uso:
    uvicorn api_events:app --reload
    -> http://localhost:8000/api/events/map
"""

from datetime import datetime
from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from sqlalchemy.orm import joinedload

from database.connection import SessionLocal
from database.models import Event, EventGenre

app = FastAPI(title="Rave Radar AR - API")

# Permite que el frontend (en otro puerto durante desarrollo) consulte esto
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ajustar a un dominio concreto antes de produccion
    allow_methods=["GET"],
    allow_headers=["*"],
)


class MapEvent(BaseModel):
    """Forma exacta de cada evento tal como lo consume el mapa."""
    id: str
    name: str
    date_from: str
    venue_name: str | None
    venue_precision: str | None
    lat: float | None
    lng: float | None
    ticket_url: str | None
    flyer_url: str | None
    genres: list[str]


def _extract_coords(venue) -> tuple[float | None, float | None]:
    """PostGIS Geometry -> (lat, lng). None si el venue no tiene coordenadas."""
    if venue is None or venue.coordinates is None:
        return None, None
    point = to_shape(venue.coordinates)
    return point.y, point.x  # to_shape da (x=lng, y=lat)


@app.get("/api/events/map", response_model=list[MapEvent])
def get_map_events():
    db = SessionLocal()
    try:
        events = (
            db.query(Event)
            .options(
                joinedload(Event.venue),
                joinedload(Event.genres).joinedload(EventGenre.genre),
            )
            .filter(Event.is_active == True)
            .all()
        )

        result = []
        skipped_no_venue = 0
        skipped_no_coords = 0

        for ev in events:
            if ev.venue is None:
                skipped_no_venue += 1
                continue

            lat, lng = _extract_coords(ev.venue)
            if lat is None:
                skipped_no_coords += 1
                continue

            result.append(MapEvent(
                id=str(ev.id),
                name=ev.name,
                date_from=ev.date_from.isoformat() if ev.date_from else "",
                venue_name=ev.venue.name if ev.venue else None,
                venue_precision=ev.venue.precision if ev.venue else None,
                lat=lat,
                lng=lng,
                ticket_url=ev.ticket_url,
                flyer_url=ev.flyer_url,
                genres=[eg.genre.name for eg in ev.genres if eg.genre],
            ))

        # Log simple a consola -- ver estos numeros en la primera corrida
        # real es exactamente el tipo de "falla del backend" que buscamos
        print(f"[/api/events/map] total activos: {len(events)} | "
              f"devueltos: {len(result)} | sin venue: {skipped_no_venue} | "
              f"sin coordenadas: {skipped_no_coords}")

        return result
    finally:
        db.close()