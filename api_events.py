"""
API de Rave Radar AR: mapa interactivo + chat + auth + preferencias.

Endpoints propios de este archivo:
  GET  /api/events/map  -> eventos con coordenadas para pintar en el mapa,
                            con filtro de fecha opcional (estructural, sin LLM)
  POST /api/chat         -> ejecuta el agente formal (rag/agent.py, grafo de
                            LangGraph) que encadena segmentacion, resolucion
                            de entidades, ejecucion de la busqueda (SQL o
                            Qdrant), filtrado por eventos ubicables, y
                            reordenamiento por preferencia de genero si hay
                            un usuario logueado con generos guardados, antes
                            de generar la respuesta. Devuelve el texto Y los
                            eventos recomendados (mismo formato que el mapa).

Los endpoints de /api/auth/* y /api/users/* viven en auth/router.py y
users/router.py respectivamente, incluidos mas abajo.

Nota sobre serializacion: UUID -> string, datetime -> ISO 8601,
Geometry(PostGIS) -> (lat, lng).

Uso:
    uvicorn api_events:app --reload
    -> http://localhost:8000/api/events/map
    -> http://localhost:8000/api/chat (POST, body: {"query": "..."})
"""

from datetime import datetime, timezone

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import joinedload

from auth.dependencies import get_current_user_optional
from auth.router import router as auth_router
from database.connection import SessionLocal
from database.models import Event, EventGenre, User
from rag.agent import run_agent
from users.router import get_user_genre_weights, router as users_router

app = FastAPI(title="Rave Radar AR - API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(users_router)

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
    chat. Devuelve None si el evento no tiene venue o coordenadas.
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
def chat(request: ChatRequest, user: User | None = Depends(get_current_user_optional)):
    """
    Ejecuta el agente formal de LangGraph (rag/agent.py): segmentar ->
    rutear -> ejecutar (arista condicional: SQL / Qdrant / vacio) ->
    filtrar por mapeable -> reordenar por preferencia de genero (si hay
    usuario logueado con generos guardados) -> generar. La sesion es
    OPCIONAL: sin token, o con un token invalido/vencido, el chat sigue
    funcionando igual, simplemente sin ese reordenamiento. Si algo falla,
    devuelve un mensaje de error legible en vez de un 500 crudo.
    """
    db = SessionLocal()
    try:
        user_genre_weights = get_user_genre_weights(db, user.id) if user else None

        final_state = run_agent(
            db, _embedding_model, _qdrant_client, request.query,
            user_genre_weights=user_genre_weights,
        )
        events = final_state["events"]
        response_text = final_state["response_text"]

        map_events = []
        for ev in events:
            me = _event_to_map_event(ev)
            if me is not None:
                map_events.append(me)

        print(f"[/api/chat] query: {request.query!r} | usuario: {user.email if user else 'anonimo'} | "
              f"estrategia: {final_state['strategy']} | eventos: {len(events)} | "
              f"con coordenadas: {len(map_events)}")

        return ChatResponse(response_text=response_text, events=map_events)

    except Exception as exc:
        print(f"[/api/chat] ERROR procesando {request.query!r}: {exc}")
        return ChatResponse(
            response_text="Uy, tuve un problema procesando tu consulta. Probá de nuevo en un momento.",
            events=[],
        )
    finally:
        db.close()