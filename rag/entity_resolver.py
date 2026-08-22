"""
Resuelve candidatos de texto extraídos de una consulta en lenguaje natural
contra las tablas reales de la base de datos (djs, venues, genres, cities),
usando similitud de trigramas (pg_trgm) — nunca le pide a un LLM que
"adivine" a qué entidad se refiere un nombre propio.

Requiere la extensión pg_trgm habilitada en Postgres (ya la creamos antes,
pero por las dudas queda el CREATE EXTENSION IF NOT EXISTS).
"""

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

# (nombre_tabla, columna_id, columna_nombre, tipo_resultado)
CANDIDATE_TABLES = [
    ("djs", "id", "name", "dj"),
    ("venues", "id", "name", "venue"),
    ("genres", "id", "name", "genre"),
    ("cities", "id", "name", "city"),
]

MIN_SCORE = 0.4  # por debajo de esto, no se considera un match confiable


@dataclass
class ResolvedEntity:
    candidate: str
    entity_type: str  # "dj" | "venue" | "genre" | "city"
    entity_id: str
    matched_name: str
    score: float


def resolve_candidate(db: Session, candidate: str, min_score: float = MIN_SCORE) -> ResolvedEntity | None:
    """
    Busca `candidate` contra djs, venues, genres y cities al mismo tiempo,
    y devuelve el mejor match si supera min_score. Si ninguna tabla da un
    match confiable, devuelve None — el candidato debería tratarse como
    texto libre para la búsqueda semántica en Qdrant.
    """
    best: ResolvedEntity | None = None

    for table, id_col, name_col, entity_type in CANDIDATE_TABLES:
        query = text(f"""
            SELECT {id_col} AS id, {name_col} AS name, similarity({name_col}, :q) AS score
            FROM {table}
            WHERE similarity({name_col}, :q) > 0.1
            ORDER BY score DESC
            LIMIT 1
        """)
        row = db.execute(query, {"q": candidate}).first()
        if row and (best is None or row.score > best.score):
            best = ResolvedEntity(
                candidate=candidate,
                entity_type=entity_type,
                entity_id=str(row.id),
                matched_name=row.name,
                score=float(row.score),
            )

    if best and best.score >= min_score:
        return best
    return None


def resolve_candidates(db: Session, candidates: list[str], min_score: float = MIN_SCORE) -> dict:
    """
    Resuelve una lista de candidatos. Devuelve:
      - "resolved": los que matchearon con confianza (tipo, id, nombre real, score)
      - "unresolved": los que no matchearon nada (van como texto libre al vector)
    """
    resolved = []
    unresolved = []
    for c in candidates:
        r = resolve_candidate(db, c, min_score=min_score)
        if r:
            resolved.append(r)
        else:
            unresolved.append(c)
    return {"resolved": resolved, "unresolved": unresolved}