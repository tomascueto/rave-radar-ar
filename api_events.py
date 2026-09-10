"""
API de Rave Radar AR: mapa interactivo + chat.

Dos endpoints:
  GET  /api/events/map  -> eventos con coordenadas para pintar en el mapa,
                            con filtro de fecha opcional (estructural, sin LLM)
  POST /api/chat         -> pipeline completo del chatbot: segmenta la
                            consulta, resuelve entidades, ejecuta la busqueda
                            (SQL o Qdrant), y genera la respuesta en lenguaje
                            natural. Devuelve el texto Y los eventos
                            recomendados (en el mismo formato que el mapa),
                            para que el frontend pueda actualizar los pines
                            con lo que el chat recomendo.

Nota sobre serializacion (ver comentarios originales): UUID -> string,
datetime -> ISO 8601, Geometry(PostGIS) -> (lat, lng).

Uso:
    uvicorn api_events:app --reload
    -> http://localhost:8000/api/events/map
    -> http://localhost:8000/api/chat (POST, body: {"query": "..."})
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import joinedload

from database.connection import SessionLocal
from database.models import Event, EventGenre
from rag.query_executor import execute
from rag.response_generator import generate_response
from rag.router import route_query

app = FastAPI(title="Rave Radar AR - API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ajustar a un dominio concreto antes de produccion
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Se cargan UNA sola vez al arrancar el servidor, no en cada request del
# chat -- cargar el modelo de embeddings por consulta agregaria varios
# segundos a cada mensaje.
print("Cargando modelo de embeddings (puede tardar unos segundos)...")
_embedding_model = SentenceTransformer("intfloat/multilingual-e5-large")
_qdrant_client = QdrantClient(host="localhost", port=6333)
print("Modelo cargado. Servidor listo.")


class MapEvent(BaseModel):
    """Forma exacta de cada evento tal como lo consumen el mapa y el chat."""
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


class ChatRequest(BaseModel):
    query: str


class ChatResponse(BaseModel):
    response_text: str
    events: list[MapEvent]


def _extract_coords(venue) -> tuple[float | None, float | None]:
    """PostGIS Geometry -> (lat, lng). None si el venue no tiene coordenadas."""
    if venue is None or venue.coordinates is None:
        return None, None
    point = to_shape(venue.coordinates)
    return point.y, point.x  # to_shape da (x=lng, y=lat)


def _event_to_map_event(ev: Event) -> MapEvent | None:
    """
    Convierte un Event de SQLAlchemy al formato que consumen el mapa y el
    chat. Devuelve None si el evento no tiene venue o coordenadas -- mismo
    criterio de descarte que ya usaba /api/events/map, factorizado aca para
    no duplicarlo entre los dos endpoints.
    """
    if ev.venue is None:
        return None
    lat, lng = _extract_coords(ev.venue)
    if lat is None:
        return None
    return MapEvent(
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
    )


@app.get("/api/events/map", response_model=list[MapEvent])
def get_map_events(date_from: datetime | None = None, date_to: datetime | None = None):
    db = SessionLocal()
    try:
        query = db.query(Event).options(
            joinedload(Event.venue),
            joinedload(Event.genres).joinedload(EventGenre.genre),
        )

        lower_bound = date_from or datetime.now(timezone.utc)
        query = query.filter(Event.date_from >= lower_bound)
        if date_to:
            query = query.filter(Event.date_from < date_to)

        events = query.all()

        result = []
        skipped = 0
        for ev in events:
            me = _event_to_map_event(ev)
            if me is None:
                skipped += 1
                continue
            result.append(me)

        print(f"[/api/events/map] rango: {lower_bound} -> {date_to or 'sin tope'} | "
              f"encontrados: {len(events)} | devueltos: {len(result)} | descartados: {skipped}")

        return result
    finally:
        db.close()


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """
    Pipeline completo: segmentar -> resolver entidades -> ejecutar
    (SQL o Qdrant) -> generar respuesta. Si algo falla (por ejemplo, cuota
    de Gemini agotada), devuelve un mensaje de error legible en vez de un
    500 crudo -- el frontend siempre recibe una respuesta con la misma forma.
    """
    db = SessionLocal()
    try:
        route_result = route_query(db, request.query)
        events = execute(
            db, route_result,
            model=_embedding_model, client=_qdrant_client,
        )
        response_text = generate_response(
            request.query, events,
            unresolved_expressions=route_result.filters.get("unresolved_expressions"),
        )

        map_events = []
        for ev in events:
            me = _event_to_map_event(ev)
            if me is not None:
                map_events.append(me)

        print(f"[/api/chat] query: {request.query!r} | estrategia: {route_result.strategy} | "
              f"eventos: {len(events)} | con coordenadas: {len(map_events)}")

        return ChatResponse(response_text=response_text, events=map_events)

    except Exception as exc:
        print(f"[/api/chat] ERROR procesando {request.query!r}: {exc}")
        return ChatResponse(
            response_text="Uy, tuve un problema procesando tu consulta. Probá de nuevo en un momento.",
            events=[],
        )
    finally:
        db.close()