"""
Ejecuta un RouteResult (la decisión del router) contra la base de datos
correspondiente y devuelve los eventos reales.

  - strategy == "sql":    query directa a PostgreSQL con los filtros exactos
  - strategy == "qdrant":  filtro exacto (payload) + búsqueda semántica (vector),
                           luego se completan los datos desde PostgreSQL

Principio de diseño: los filtros ya vienen resueltos y verificados por el
router (entity_resolver + interpret_date/interpret_price) — este módulo
solo traduce esos filtros al lenguaje de cada motor de consulta, sin volver
a interpretar nada.
"""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Filter, FieldCondition, MatchValue, MatchAny, Range, DatetimeRange,
)
from sentence_transformers import SentenceTransformer

from database.models import Event, EventDJ, EventGenre, DJ, Genre
from rag.router import RouteResult

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION_NAME = "events"
DEFAULT_LIMIT = 20


# ─── Rama SQL ──────────────────────────────────────────────────────────────

def execute_sql(db: Session, filters: dict, limit: int = DEFAULT_LIMIT) -> list[Event]:
    query = (
        db.query(Event)
        .options(
            joinedload(Event.venue),
            joinedload(Event.genres).joinedload(EventGenre.genre),
            joinedload(Event.djs).joinedload(EventDJ.dj),
        )
        .filter(Event.is_active == True)
    )

    if "venue_id" in filters:
        query = query.filter(Event.venue_id == filters["venue_id"])
    if "city_id" in filters:
        query = query.filter(Event.city_id == filters["city_id"])
    if "date_from_start" in filters:
        query = query.filter(Event.date_from >= filters["date_from_start"])
        query = query.filter(Event.date_from < filters["date_from_end"])
    if "max_price" in filters:
        query = query.filter(Event.min_price <= filters["max_price"])
    if "dj_names" in filters:
        query = query.join(EventDJ).join(DJ).filter(DJ.name.in_(filters["dj_names"]))
    if "genre_slugs" in filters:
        query = query.join(EventGenre).join(Genre).filter(Genre.slug.in_(filters["genre_slugs"]))

    return (
        query.distinct()
        .order_by(Event.date_from.asc())
        .limit(limit)
        .all()
    )


# ─── Rama Qdrant ─────────────────────────────────────────────────────────────

def _build_qdrant_filter(filters: dict) -> Filter:
    conditions = [FieldCondition(key="is_active", match=MatchValue(value=True))]

    if "venue_id" in filters:
        conditions.append(FieldCondition(key="venue_id", match=MatchValue(value=filters["venue_id"])))
    if "city_id" in filters:
        conditions.append(FieldCondition(key="city_id", match=MatchValue(value=filters["city_id"])))
    if "genre_slugs" in filters:
        conditions.append(FieldCondition(key="genre_slugs", match=MatchAny(any=filters["genre_slugs"])))
    if "dj_names" in filters:
        conditions.append(FieldCondition(key="dj_names", match=MatchAny(any=filters["dj_names"])))
    if "max_price" in filters:
        conditions.append(FieldCondition(key="min_price", range=Range(lte=filters["max_price"])))
    if "date_from_start" in filters:
        conditions.append(FieldCondition(
            key="date_from",
            range=DatetimeRange(
                gte=filters["date_from_start"].isoformat(),
                lt=filters["date_from_end"].isoformat(),
            ),
        ))

    return Filter(must=conditions)


def execute_qdrant(
    db: Session,
    model: SentenceTransformer,
    client: QdrantClient,
    filters: dict,
    semantic_text: str,
    limit: int = DEFAULT_LIMIT,
) -> list[Event]:
    query_vector = model.encode(f"query: {semantic_text}").tolist()
    qdrant_filter = _build_qdrant_filter(filters)

    response = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=qdrant_filter,
        limit=limit,
    )

    event_ids = [r.payload["event_id"] for r in response.points]
    if not event_ids:
        return []

    events = (
        db.query(Event)
        .options(
            joinedload(Event.venue),
            joinedload(Event.genres).joinedload(EventGenre.genre),
            joinedload(Event.djs).joinedload(EventDJ.dj),
        )
        .filter(Event.id.in_(event_ids))
        .all()
    )
    order = {eid: i for i, eid in enumerate(event_ids)}
    events.sort(key=lambda e: order.get(str(e.id), len(order)))
    return events


# ─── Punto de entrada único ──────────────────────────────────────────────────

def execute(
    db: Session,
    route_result: RouteResult,
    model: SentenceTransformer | None = None,
    client: QdrantClient | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[Event]:
    if route_result.strategy == "sql":
        return execute_sql(db, route_result.filters, limit=limit)

    if model is None or client is None:
        raise ValueError("Se requieren model y client para ejecutar la rama Qdrant.")
    return execute_qdrant(
        db, model, client,
        route_result.filters, route_result.semantic_text,
        limit=limit,
    )