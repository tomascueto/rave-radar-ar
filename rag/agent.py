"""
Agente formal del pipeline de recuperación semántica, implementado como un
grafo de estado con LangGraph, conforme al diseño presentado en el
Capítulo 3.

Hasta este punto del desarrollo, las mismas cuatro etapas (segmentar,
rutear, ejecutar, generar) se invocaban como una secuencia de llamadas a
función directas desde el endpoint /api/chat. Este módulo no cambia esa
lógica — cada nodo reutiliza exactamente las mismas funciones ya
validadas de forma aislada en router.py, query_executor.py y
response_generator.py, sin duplicarlas — sino que la expone como un grafo
explícito, donde la decisión entre SQL directo, búsqueda híbrida en
Qdrant, o corte por restricción geográfica no resuelta (Sección 4.10.2)
es una arista condicional de primera clase, no un valor de retorno opaco
dentro de una función.

Limitación conocida: el grafo, al igual que el pipeline que reemplaza, es
STATELESS entre turnos de una misma conversación — cada consulta se
procesa sin ningún conocimiento de mensajes anteriores. Incorporar
memoria de conversación queda como trabajo pendiente, facilitado -- no
resuelto -- por esta formalización.
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
        # Reutiliza route_from_segments tal cual -- ya probado de forma
        # aislada (resolución de entidades, fecha/precio determinísticos,
        # location_expr) -- en vez de duplicar esa lógica en el nodo.
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
    graph.add_node("generate", generate_node)

    graph.set_entry_point("segment")
    graph.add_edge("segment", "route")
    graph.add_conditional_edges("route", pick_strategy, {
        "sql": "execute_sql",
        "qdrant": "execute_qdrant",
        "empty": "execute_empty",
    })
    graph.add_edge("execute_sql", "generate")
    graph.add_edge("execute_qdrant", "generate")
    graph.add_edge("execute_empty", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


def run_agent(db: Session, model: SentenceTransformer, client: QdrantClient, query: str) -> AgentState:
    """Punto de entrada de conveniencia: construye, ejecuta y devuelve el estado final."""
    agent = build_agent(db, model, client)
    return agent.invoke({"query": query})