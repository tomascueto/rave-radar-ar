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

import uuid
from datetime import datetime, timezone

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import joinedload

from auth.dependencies import get_current_user, get_current_user_optional
from auth.router import router as auth_router
from database.connection import SessionLocal
from database.models import Conversation, ConversationMessage, Event, EventGenre, User, UserSavedEvent
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
    genre_ids: list[str]


HISTORY_WINDOW_SIZE = 6  # ultimos N mensajes (usuario + asistente combinados) que se le pasan al segmentador como contexto


class ChatRequest(BaseModel):
    query: str
    conversation_id: str | None = None
    user_lat: float | None = None
    user_lng: float | None = None


class ChatResponse(BaseModel):
    response_text: str
    events: list[MapEvent]
    conversation_id: str


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

    Nota: NO calcula afinidad de preferencias acá -- eso se mueve al
    cliente (Map.jsx), que la recalcula en cada render usando genre_ids +
    los pesos actuales del usuario. Antes se calculaba una sola vez acá y
    quedaba "horneada" en el evento devuelto, lo cual producía colores
    desactualizados en resultados del chat guardados de antes de un
    cambio de preferencias -- el cliente, en cambio, siempre usa el peso
    más reciente disponible al momento de dibujar.
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
        genre_ids=[str(eg.genre_id) for eg in ev.genres],
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


def _resolve_conversation(db, conversation_id: str | None, user: User | None) -> Conversation:
    """
    Busca la conversacion por id si se paso uno valido y corresponde al
    usuario actual (o es anonima); si no, crea una nueva. Nunca reutiliza
    una conversacion que le pertenece a OTRO usuario logueado distinto --
    en ese caso, arranca una nueva en silencio en vez de mezclar
    historiales de dos personas.
    """
    conversation = None
    if conversation_id:
        try:
            conv_uuid = uuid.UUID(conversation_id)
            conversation = db.query(Conversation).filter(Conversation.id == conv_uuid).first()
        except ValueError:
            conversation = None

        if conversation and conversation.user_id is not None:
            if user is None or conversation.user_id != user.id:
                conversation = None

    if conversation is None:
        conversation = Conversation(user_id=user.id if user else None)
        db.add(conversation)
        db.flush()  # asigna conversation.id sin cerrar la transaccion

    return conversation


def _load_recent_history(db, conversation_id) -> list[dict]:
    """Ultimos HISTORY_WINDOW_SIZE mensajes de la conversacion, en orden
    cronologico (mas viejo primero) -- es el formato que espera
    segment_query(). Ventana acotada a proposito: el tipo de referencia
    que necesitamos resolver ("¿y alguno mas barato?") es siempre de corto
    alcance, no hace falta ni conviene mandarle al LLM la conversacion
    entera."""
    rows = (
        db.query(ConversationMessage)
        .filter(ConversationMessage.conversation_id == conversation_id)
        .order_by(ConversationMessage.created_at.desc())
        .limit(HISTORY_WINDOW_SIZE)
        .all()
    )
    rows.reverse()
    return [{"role": row.role, "content": row.content} for row in rows]


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

    Memoria conversacional: si el cliente manda conversation_id, se
    reutiliza esa conversacion y se le pasa al segmentador el historial
    reciente, para que pueda resolver referencias como "¿y alguno mas
    barato?" en el contexto de lo que se pregunto antes. Si no manda uno
    (o el que manda no es valido / no le pertenece), se crea una
    conversacion nueva -- el id resultante siempre viaja de vuelta en la
    respuesta, para que el cliente lo guarde y lo reuse en el proximo
    mensaje.
    """
    db = SessionLocal()
    try:
        user_genre_weights = get_user_genre_weights(db, user.id) if user else None

        conversation = _resolve_conversation(db, request.conversation_id, user)
        history = _load_recent_history(db, conversation.id)

        final_state = run_agent(
            db, _embedding_model, _qdrant_client, request.query,
            history=history,
            user_genre_weights=user_genre_weights,
            user_lat=request.user_lat, user_lng=request.user_lng,
        )
        events = final_state["events"]
        response_text = final_state["response_text"]

        map_events = []
        for ev in events:
            me = _event_to_map_event(ev)
            if me is not None:
                map_events.append(me)

        db.add(ConversationMessage(conversation_id=conversation.id, role="user", content=request.query))
        db.add(ConversationMessage(conversation_id=conversation.id, role="assistant", content=response_text))
        db.commit()

        print(f"[/api/chat] query: {request.query!r} | usuario: {user.email if user else 'anonimo'} | "
              f"conversacion: {conversation.id} | historial usado: {len(history)} mensajes | "
              f"estrategia: {final_state['strategy']} | eventos: {len(events)} | "
              f"con coordenadas: {len(map_events)}")

        return ChatResponse(
            response_text=response_text, events=map_events, conversation_id=str(conversation.id)
        )

    except Exception as exc:
        db.rollback()
        print(f"[/api/chat] ERROR procesando {request.query!r}: {exc}")
        return ChatResponse(
            response_text="Uy, tuve un problema procesando tu consulta. Probá de nuevo en un momento.",
            events=[],
            conversation_id=request.conversation_id or "",
        )
    finally:
        db.close()


@app.get("/api/users/me/saved-events", response_model=list[MapEvent])
def get_my_saved_events(user: User = Depends(get_current_user)):
    """
    Detalle completo (foto, venue, generos, etc.) de los eventos que el
    usuario guardo. Vive aca, no en users/router.py, porque necesita
    MapEvent y _event_to_map_event, definidos en este archivo -- ponerlo
    en users/router.py obligaria a importar desde aca hacia alla, y este
    archivo ya importa DE users/router.py (get_user_genre_weights),
    generando un import circular.
    """
    db = SessionLocal()
    try:
        saved_ids = [
            row[0] for row in
            db.query(UserSavedEvent.event_id).filter(UserSavedEvent.user_id == user.id).all()
        ]
        if not saved_ids:
            return []

        events = (
            db.query(Event)
            .options(
                joinedload(Event.venue),
                joinedload(Event.genres).joinedload(EventGenre.genre),
            )
            .filter(Event.id.in_(saved_ids))
            .all()
        )

        result = []
        for ev in events:
            me = _event_to_map_event(ev)
            if me is not None:
                result.append(me)
        return result
    finally:
        db.close()