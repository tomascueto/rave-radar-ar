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

Limitación conocida: el grafo es STATELESS entre turnos de una misma
conversación — cada consulta se procesa sin ningún conocimiento de
mensajes anteriores.
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
    segmented: dict
    filters: dict
    strategy: Literal["sql", "qdrant", "empty"]
    semantic_text: str | None
    events: list[Event]
    response_text: str
    user_genre_ids: set[str] | None


def build_agent(db: Session, model: SentenceTransformer, client: QdrantClient):
    """
    Construye y compila el grafo. Recibe la sesión de base de datos y las
    dependencias de búsqueda semántica como closures, siguiendo el mismo
    patrón de inyección que ya usaban route_query() y execute() -- evita
    reabrir conexiones o recargar el modelo de embeddings en cada nodo.
    """

    def segment_node(state: AgentState) -> dict:
        return {"segmented": segment_query(state["query"])}

    def route_node(state: AgentState) -> dict:
        result = route_from_segments(db, state["segmented"])
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
        Si hay un usuario logueado con géneros favoritos guardados, los
        eventos que coinciden con alguno de esos géneros se reordenan
        primero -- sin sacar ni agregar ningún evento, solo reordenando lo
        que ya se recuperó. Sort estable: dentro de "coincide" y "no
        coincide", se respeta el orden relativo que ya traían (cronológico
        en la rama SQL, por relevancia semántica en la rama Qdrant).
        """
        preferred = state.get("user_genre_ids")
        if not preferred:
            return {}

        def matches_preference(ev: Event) -> bool:
            event_genre_ids = {str(eg.genre_id) for eg in ev.genres}
            return not event_genre_ids.isdisjoint(preferred)

        reranked = sorted(state["events"], key=lambda ev: not matches_preference(ev))
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
    user_genre_ids: set[str] | None = None,
) -> AgentState:
    """Punto de entrada de conveniencia: construye, ejecuta y devuelve el estado final."""
    agent = build_agent(db, model, client)
    return agent.invoke({"query": query, "user_genre_ids": user_genre_ids})