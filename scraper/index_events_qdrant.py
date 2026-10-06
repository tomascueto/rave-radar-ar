# scraper/index_events_qdrant.py
"""
Indexa los eventos de PostgreSQL en Qdrant, generando embeddings con la API
de Gemini (gemini-embedding-001) -- reemplaza al modelo local
(multilingual-e5-large via sentence-transformers) que se usaba antes.
Requiere GEMINI_API_KEY seteada y conexión a internet; ya no corre offline.

Diseño (búsqueda híbrida):
  - El VECTOR contiene únicamente texto semántico libre: nombre del evento,
    descripción, géneros musicales y lineup de DJs. Es lo que se compara por
    similitud cuando el usuario hace una consulta ambigua ("algo under y
    groovy").
  - El PAYLOAD contiene metadata estructurada para filtrado exacto: venue,
    ciudad, fecha, precio, ids de DJs/géneros. Es lo que se usa cuando el
    usuario menciona algo puntual ("eventos en Crobar", "este sábado",
    "menos de $20.000") -- esto NO depende de similitud semántica, es un
    filtro tipo WHERE de SQL sobre el payload.

Nota sobre task_type: a diferencia de E5 (que requería prefijos de texto
tipo "passage: "/"query: "), el modelo de Gemini distingue indexado vs.
consulta con el parámetro task_type de la config -- este script indexa con
RETRIEVAL_DOCUMENT, y la consulta del usuario en tiempo real (rag/
query_executor.py) usa RETRIEVAL_QUERY. output_dimensionality=768 (no el
default de 3072) para mantener el vector chico y manejable en Qdrant --
tiene que coincidir exactamente con el de query_executor.py y con la
dimensión de la colección (ver EMBEDDING_DIM).

Nota sobre el id de cada punto: se usa el MISMO id que el evento ya tiene
en Postgres (str(event.id)), no un uuid4 nuevo en cada corrida. Qdrant
hace upsert por id -- con un id fijo, re-indexar un evento ya existente
actualiza su punto; con un id random nuevo cada vez, cada corrida agregaba
un duplicado del mismo evento en vez de actualizarlo.

Uso:
    python -m scraper.index_events_qdrant
"""

import logging
import os
import time

from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams
from sqlalchemy.orm import Session, joinedload

from database.connection import SessionLocal
from database.models import DJ, Event, EventDJ, EventGenre, Genre, Venue
from rag.retry_helper import call_with_retry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

load_dotenv()

COLLECTION_NAME = "events"
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768  # ver nota sobre task_type/output_dimensionality arriba
BATCH_SIZE = 32


EVENT_TYPE_HINTS = {
    "sunset": "Evento de sunset, al atardecer.",
    "after": "After, para la madrugada.",
    "party": "Fiesta nocturna.",
}


def build_embedding_text(event: Event) -> str:
    """
    Arma el texto que se convierte en vector: SOLO contenido semántico
    libre, sin datos estructurados (esos van al payload). A diferencia de
    E5, Gemini no requiere un prefijo en el texto -- la distinción
    indexado/consulta se hace con task_type en la config de la llamada
    (ver nota al principio del archivo).

    event_type (sunset/after/party) se agrega como una frase corta --
    sin esto, esa información vive solo en el payload (sirve para
    filtrar) pero nunca llega al texto que se compara por significado,
    así que una consulta tipo "algo tranquilo de tarde" no tiene forma
    de asociarse con un evento de sunset por más que lo sea.
    """
    parts = [event.name]

    tipo = event.event_type.value if hasattr(event.event_type, "value") else event.event_type
    if tipo in EVENT_TYPE_HINTS:
        parts.append(EVENT_TYPE_HINTS[tipo])

    genre_names = [eg.genre.name for eg in event.genres if eg.genre]
    if genre_names:
        parts.append("Géneros: " + ", ".join(genre_names))

    dj_names = [ed.dj.name for ed in event.djs if ed.dj]
    if dj_names:
        parts.append("Line-up: " + ", ".join(dj_names))

    if event.description:
        parts.append(event.description)

    return ". ".join(parts)


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
        "event_type": event.event_type.value if hasattr(event.event_type, "value") else event.event_type,
        "is_active": event.is_active,
        "genre_slugs": [eg.genre.slug for eg in event.genres if eg.genre],
        "dj_names": [ed.dj.name for ed in event.djs if ed.dj],
        "flyer_url": event.flyer_url,
        "ticket_url": event.ticket_url,
    }


def _embed_batch(genai_client: genai.Client, texts: list[str]) -> list[list[float]]:
    """
    Embebe un batch de textos, con reintento propio ante 429 del free tier
    de Gemini. A diferencia de rag/retry_helper.py (que no reintenta 429
    porque asume cuota DIARIA agotada, donde esperar no sirve), el 429 de
    embed_content en free tier es un límite POR MINUTO (100 requests/min,
    contado por texto, no por llamada) que se resetea solo -- confirmado
    empíricamente corriendo este script: falla siempre justo después de
    96 textos (3 batches de 32), con "Please retry in ~59s" en el mensaje.
    """
    for attempt in range(3):
        try:
            response = call_with_retry(
                genai_client.models.embed_content,
                model=EMBEDDING_MODEL,
                contents=texts,
                config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": EMBEDDING_DIM},
            )
            return [e.values for e in response.embeddings]
        except genai_errors.ClientError as exc:
            if exc.code == 429 and attempt < 2:
                log.warning("Límite por minuto del free tier de Gemini -- esperando 61s antes de reintentar...")
                time.sleep(61)
            else:
                raise


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
    genai_client = genai.Client()

    client = QdrantClient(
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY"),
    )

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
            vectors = _embed_batch(genai_client, texts)

            points = [
                PointStruct(
                    id=str(batch[j].id),  # mismo id que ya tiene en Postgres --
                    # asi reindexar el mismo evento actualiza su punto
                    # existente en vez de crear uno nuevo cada corrida
                    vector=vectors[j],
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