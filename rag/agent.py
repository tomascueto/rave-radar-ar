"""
Agente formal del pipeline de recuperación semántica, implementado como un
grafo de estado con LangGraph, conforme al diseño presentado en el
Capítulo 3.

Cada nodo reutiliza exactamente las mismas funciones ya validadas de forma
aislada en router.py, query_executor.py y response_generator.py, sin
duplicarlas — la expone como un grafo explícito, donde la decisión entre
SQL directo, búsqueda híbrida en Qdrant, o corte por restricción
geográfica no resuelta es una arista condicional de primera clase, no un
valor de retorno opaco dentro de una función.

Grafo: segment -> route -> (sql | qdrant | empty) -> filter_mappable ->
rerank_by_preference -> generate

Memoria conversacional: el grafo en si sigue siendo STATELESS por
ejecucion (no guarda nada entre invocaciones) -- la continuidad entre
turnos se logra pasandole el historial reciente como parte del estado de
ENTRADA (AgentState.history), que solo usa el nodo segment. El resto del
pipeline (route, execute, filter, rerank, generate) nunca se entera de
que existe una conversacion: recibe una segmentacion ya resuelta y
completa, como si el usuario hubiera escrito todo en un solo mensaje.
Ver rag/query_segmenter.py para el detalle de como se resuelve.
"""

from __future__ import annotations

from typing import TypedDict, Literal

from langgraph.graph import StateGraph, END
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from sqlalchemy.orm import Session

from database.models import Event
from rag.query_executor import execute_sql, execute_qdrant
from rag.query_segmenter import segment_query
from rag.response_generator import generate_response
from rag.router import route_from_segments


class AgentState(TypedDict):
    query: str
    history: list[dict] | None
    segmented: dict
    filters: dict
    strategy: Literal["sql", "qdrant", "empty"]
    semantic_text: str | None
    events: list[Event]
    response_text: str
    user_genre_weights: dict[str, float] | None
    user_preferred_city_id: str | None
    user_lat: float | None
    user_lng: float | None


def build_agent(db: Session, model: SentenceTransformer, client: QdrantClient):
    """
    Construye y compila el grafo. Recibe la sesión de base de datos y las
    dependencias de búsqueda semántica como closures, siguiendo el mismo
    patrón de inyección que ya usaban route_query() y execute() -- evita
    reabrir conexiones o recargar el modelo de embeddings en cada nodo.
    """

    def segment_node(state: AgentState) -> dict:
        return {"segmented": segment_query(state["query"], history=state.get("history"))}

    def route_node(state: AgentState) -> dict:
        result = route_from_segments(
            db, state["segmented"],
            user_lat=state.get("user_lat"), user_lng=state.get("user_lng"),
        )
        return {
            "filters": result.filters,
            "strategy": result.strategy,
            "semantic_text": result.semantic_text,
        }

    def execute_sql_node(state: AgentState) -> dict:
        return {"events": execute_sql(db, state["filters"])}

    def execute_qdrant_node(state: AgentState) -> dict:
        events = execute_qdrant(db, model, client, state["filters"], state["semantic_text"])
        return {"events": events}

    def execute_empty_node(state: AgentState) -> dict:
        return {"events": []}

    def filter_mappable_node(state: AgentState) -> dict:
        """
        Solo se conservan eventos con venue asignado y coordenadas resueltas
        -- un evento que no se puede ubicar en el mapa no es una
        recomendación completa para esta aplicación.
        """
        mappable = [
            ev for ev in state["events"]
            if ev.venue is not None and ev.venue.coordinates is not None
        ]
        return {"events": mappable}

    def rerank_by_preference_node(state: AgentState) -> dict:
        """
        Reordena combinando afinidad de género y ciudad preferida, con dos
        modos según si la consulta ya nombra un género explícito o no --
        validado con un caso real (usuario con ciudad preferida en Río
        Negro, sin 'Techno' entre sus géneros favoritos, buscando
        "eventos de techno": la ciudad nunca pudo competir ni con la
        afinidad más chica posible, porque son señales de naturaleza
        distinta cuando el género ya viene dado por la propia consulta.

        Caso A -- consulta CON género explícito (filters["genre_slugs"]
        no vacío, ya calculado de forma determinística por route_from_
        segments): el filtro de búsqueda garantiza que todo lo que llega
        acá ya cumple ese pedido, así que lo que queda de afinidad por
        género es información secundaria (coincidencias ADEMÁS del
        género pedido), no la señal principal de intención. Se atenúa
        (no se anula) para dejarle a la ciudad preferida un peso real y
        comparable, en vez de un simple desempate: si coincide, suma un
        bonus derivado del propio peso más alto del usuario (la mitad de
        él, no un número inventado -- se ajusta solo a cómo cada usuario
        calibró su encuesta). El resultado: un evento del género pedido
        en la ciudad preferida le gana a uno del mismo género con alguna
        coincidencia secundaria en otra ciudad, pero una coincidencia
        secundaria genuinamente fuerte todavía puede pesar más que el
        bonus de ciudad -- no es una regla absoluta.

        Caso B -- consulta general (sin género explícito, o sin ciudad
        preferida seteada): se mantiene el comportamiento original. La
        encuesta de géneros es la única señal real de relevancia
        disponible, así que la ciudad actúa puramente como desempate --
        nunca le gana a una afinidad de género genuinamente mayor, sea
        cual sea su magnitud, porque no hay forma fundamentada de
        calibrar cuánto debería valer frente a pesos arbitrarios que el
        usuario nunca calibró pensando en esto.

        Sort estable en ambos casos: eventos empatados conservan el
        orden relativo previo (cronológico en la rama SQL, por
        relevancia semántica en la rama Qdrant).
        """
        weights = state.get("user_genre_weights")
        preferred_city_id = state.get("user_preferred_city_id")
        explicit_genre_query = bool(state.get("filters", {}).get("genre_slugs"))

        if not weights and not preferred_city_id:
            return {}

        def genre_affinity(ev: Event) -> float:
            if not weights:
                return 0.0
            return sum(weights.get(str(eg.genre_id), 0) for eg in ev.genres)

        def city_match(ev: Event) -> bool:
            return bool(preferred_city_id) and ev.city_id is not None and str(ev.city_id) == preferred_city_id

        if explicit_genre_query and preferred_city_id:
            max_weight = max(weights.values()) if weights else 1.0
            city_bonus = max_weight * 0.5

            def combined(ev: Event) -> float:
                return genre_affinity(ev) * 0.3 + (city_bonus if city_match(ev) else 0.0)

            reranked = sorted(state["events"], key=lambda ev: -combined(ev))
        else:
            def city_mismatch(ev: Event) -> int:
                return 0 if city_match(ev) else 1

            reranked = sorted(
                state["events"],
                key=lambda ev: (-genre_affinity(ev), city_mismatch(ev)),
            )

        return {"events": reranked}

    def generate_node(state: AgentState) -> dict:
        response_text = generate_response(
            state["query"], state["events"],
            unresolved_expressions=state["filters"].get("unresolved_expressions"),
        )
        return {"response_text": response_text}

    def pick_strategy(state: AgentState) -> str:
        return state["strategy"]

    graph = StateGraph(AgentState)
    graph.add_node("segment", segment_node)
    graph.add_node("route", route_node)
    graph.add_node("execute_sql", execute_sql_node)
    graph.add_node("execute_qdrant", execute_qdrant_node)
    graph.add_node("execute_empty", execute_empty_node)
    graph.add_node("filter_mappable", filter_mappable_node)
    graph.add_node("rerank_by_preference", rerank_by_preference_node)
    graph.add_node("generate", generate_node)

    graph.set_entry_point("segment")
    graph.add_edge("segment", "route")
    graph.add_conditional_edges("route", pick_strategy, {
        "sql": "execute_sql",
        "qdrant": "execute_qdrant",
        "empty": "execute_empty",
    })
    graph.add_edge("execute_sql", "filter_mappable")
    graph.add_edge("execute_qdrant", "filter_mappable")
    graph.add_edge("execute_empty", "filter_mappable")
    graph.add_edge("filter_mappable", "rerank_by_preference")
    graph.add_edge("rerank_by_preference", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


def run_agent(
    db: Session,
    model: SentenceTransformer,
    client: QdrantClient,
    query: str,
    history: list[dict] | None = None,
    user_genre_weights: dict[str, float] | None = None,
    user_preferred_city_id: str | None = None,
    user_lat: float | None = None,
    user_lng: float | None = None,
) -> AgentState:
    """Punto de entrada de conveniencia: construye, ejecuta y devuelve el estado final."""
    agent = build_agent(db, model, client)
    return agent.invoke({
        "query": query,
        "history": history,
        "user_genre_weights": user_genre_weights,
        "user_preferred_city_id": user_preferred_city_id,
        "user_lat": user_lat,
        "user_lng": user_lng,
    })