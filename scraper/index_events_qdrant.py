"""
Indexa los eventos de PostgreSQL en Qdrant, generando embeddings con un
modelo local (multilingual-e5-large, corre 100% offline tras la descarga
inicial — sin dependencia de ninguna API externa de pago ni con límites de
cuota).

Diseño (búsqueda híbrida):
  - El VECTOR contiene únicamente texto semántico libre: nombre del evento,
    descripción, géneros musicales y lineup de DJs. Es lo que se compara por
    similitud cuando el usuario hace una consulta ambigua ("algo under y
    groovy").
  - El PAYLOAD contiene metadata estructurada para filtrado exacto: venue,
    ciudad, fecha, precio, ids de DJs/géneros. Es lo que se usa cuando el
    usuario menciona algo puntual ("eventos en Crobar", "este sábado",
    "menos de $20.000") — esto NO depende de similitud semántica, es un
    filtro tipo WHERE de SQL sobre el payload.

Nota sobre el modelo E5: requiere prefijos especiales en el texto según la
documentación oficial — "passage: " para los textos que se indexan (este
script) y "query: " para las consultas de búsqueda (en el agente, más
adelante). Omitir el prefijo degrada la calidad de la búsqueda.

Uso:
    python -m scraper.index_events_qdrant
"""

import logging
import uuid

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import Session, joinedload

from database.connection import SessionLocal
from database.models import DJ, Event, EventDJ, EventGenre, Genre, Venue

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION_NAME = "events"
EMBEDDING_MODEL = "intfloat/multilingual-e5-large"
EMBEDDING_DIM = 1024  # confirmado empíricamente con el modelo elegido
BATCH_SIZE = 32


def build_embedding_text(event: Event) -> str:
    """
    Arma el texto que se convierte en vector: SOLO contenido semántico
    libre, sin datos estructurados (esos van al payload). El prefijo
    "passage: " es requerido por el modelo E5 para textos indexados.
    """
    parts = [event.name]

    genre_names = [eg.genre.name for eg in event.genres if eg.genre]
    if genre_names:
        parts.append("Géneros: " + ", ".join(genre_names))

    dj_names = [ed.dj.name for ed in event.djs if ed.dj]
    if dj_names:
        parts.append("Line-up: " + ", ".join(dj_names))

    if event.description:
        parts.append(event.description)

    text = ". ".join(parts)
    return f"passage: {text}"


def build_payload(event: Event) -> dict:
    """Metadata estructurada para filtros exactos en Qdrant."""
    venue: Venue | None = event.venue

    return {
        "event_id": str(event.id),
        "name": event.name,
        "date_from": event.date_from.isoformat() if event.date_from else None,
        "date_to": event.date_to.isoformat() if event.date_to else None,
        "venue_id": str(venue.id) if venue else None,
        "venue_name": venue.name if venue else None,
        "venue_precision": venue.precision if venue else None,
        "city_id": str(event.city_id) if event.city_id else None,
        "min_price": float(event.min_price) if event.min_price else None,
        "max_price": float(event.max_price) if event.max_price else None,
        "event_type": event.event_type.value if event.event_type else None,
        "is_active": event.is_active,
        "genre_slugs": [eg.genre.slug for eg in event.genres if eg.genre],
        "dj_names": [ed.dj.name for ed in event.djs if ed.dj],
        "flyer_url": event.flyer_url,
        "ticket_url": event.ticket_url,
    }


def ensure_collection(client: QdrantClient) -> None:
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME in existing:
        log.info("Colección '%s' ya existe.", COLLECTION_NAME)
        return

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
    )
    log.info("Colección '%s' creada (dim=%d, distancia=coseno).", COLLECTION_NAME, EMBEDDING_DIM)


def index_events() -> None:
    log.info("Cargando modelo de embeddings (%s)…", EMBEDDING_MODEL)
    model = SentenceTransformer(EMBEDDING_MODEL)

    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    ensure_collection(client)

    db: Session = SessionLocal()
    try:
        events = (
            db.query(Event)
            .options(
                joinedload(Event.venue),
                joinedload(Event.genres).joinedload(EventGenre.genre),
                joinedload(Event.djs).joinedload(EventDJ.dj),
            )
            .all()
        )
        total = len(events)
        log.info("Eventos a indexar: %d", total)

        indexed = 0
        for i in range(0, total, BATCH_SIZE):
            batch = events[i : i + BATCH_SIZE]

            texts = [build_embedding_text(ev) for ev in batch]
            embeddings = model.encode(texts, show_progress_bar=False)

            points = [
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embeddings[j].tolist(),
                    payload=build_payload(batch[j]),
                )
                for j in range(len(batch))
            ]

            client.upsert(collection_name=COLLECTION_NAME, points=points)
            indexed += len(batch)
            log.info("Progreso: %d/%d", indexed, total)

        log.info("✅ Indexación finalizada. %d eventos cargados en Qdrant.", indexed)

    finally:
        db.close()


if __name__ == "__main__":
    index_events()