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

# (nombre_tabla, columna_id, columna_nombre, tipo_resultado, funcion_de_similitud)
#
# "word_similarity" en vez de "similarity" para genres y djs: similarity()
# compara las dos cadenas ENTERAS, asi que un candidato corto (ej. "progre",
# "Bibi") contra un nombre largo (ej. "Progressive House", "Michael Bibi")
# da un score bajo aunque el candidato sea, en los hechos, un acierto -- el
# nombre largo "diluye" el puntaje. word_similarity() en cambio busca el
# mejor sub-fragmento del nombre largo que se parezca al candidato, que es
# exactamente el caso de una jerga/abreviatura de genero (progre, tribal,
# minimal) o un apodo/nombre parcial de DJ. Verificado contra Postgres
# real: resuelve "progre" -> "Progressive House" (antes 0.316 contra el
# umbral de 0.4) y "Bibi" -> "Michael Bibi" (antes 0.385, por debajo del
# umbral por un margen minimo -- la consulta caia al fallback semantico de
# Qdrant en vez de filtrar por el DJ exacto, y Qdrant solo no alcanzaba
# para encontrar sus eventos).  Venues y cities quedan con similarity() por
# ahora -- ahi un candidato corto corre mas riesgo de ser una palabra
# generica (ej. "Club", "Bar") que matchee por sustring contra muchos
# nombres sin relacion real entre si.
CANDIDATE_TABLES = [
    ("djs", "id", "name", "dj", "word_similarity"),
    ("venues", "id", "name", "venue", "similarity"),
    ("genres", "id", "name", "genre", "word_similarity"),
    ("cities", "id", "name", "city", "similarity"),
]

MIN_SCORE = 0.4  # por debajo de esto, no se considera un match confiable

# Candidatos que no tienen NINGUNA señal util, ni como entidad ni como
# texto libre para Qdrant -- se descartan del todo. "Argentina" es el
# unico caso hoy: toda la base de datos es de Argentina, asi que el pais
# nunca discrimina resultados en ningun lado. Ademas, con word_similarity
# matchea falsos positivos contra nombres de DJs que comparten el sufijo
# "-entina" (caso real: "Valentina Spirito", score 0.5 -- con la
# similarity() vieja daba 0.217, por eso nunca se habia notado).
IGNORED_CANDIDATES = {"argentina"}

# Candidatos que NUNCA deberian intentar resolverse como entidad exacta
# (DJ/venue/genero/ciudad) pese a que el segmenter a veces los extrae como
# si fueran nombres propios -- son palabras genericas de "tipo de evento"
# u "onda/estilo", no nombres. Verificado empiricamente contra la base
# real (no es hipotetico, cada uno matcheaba de verdad por encima del
# umbral de confianza de 0.4):
#   "fiesta"  -> DJ "Festa Bros" (0.44)
#   "evento"  -> DJ "Departamento" (0.43), venue "Magic Eventos" (0.40)
#   "joda"    -> DJs "Jorge Savoretti" / "John Cosani" / "Inda Jani" (0.40)
#   "rave"    -> DJ "Gaston Ramirez" (0.40), genero "New Wave" (0.40)
#   "show"    -> DJs "Shai T" / "SHDW" / "Kayla Shams" (0.40)
#   "noche"   -> DJ "Trasnoche Paraiso" (0.67 -- alto, no un caso limite)
#   "musica"  -> DJ "Panda Music" (0.71 -- alto)
#   "under"   -> DJ real "Underworld" (0.83) -- "under" es jerga comun
#                para "underground", pero por mala suerte coincide con un
#                DJ que existe de verdad; sin esto, "lo mas under" filtra
#                por ESE DJ puntual en vez de buscar semanticamente
#   "finde"   -> DJ "Finally Alone" (0.5) -- ademas interfiere con
#                date_range_hint="weekend" si el segmenter lo duplica aca
#
# A diferencia de IGNORED_CANDIDATES, estas palabras SI aportan señal real
# para la busqueda semantica (Qdrant) -- "under"/"rave"/"noche" describen
# onda/estilo genuinamente. Por eso no se descartan del todo: solo se
# saltea la resolucion de entidad, pero igual caen en "unresolved" y
# terminan en semantic_text como texto libre.
SKIP_ENTITY_MATCH = {
    "fiesta", "evento", "eventos", "joda", "rave", "show",
    "noche", "musica", "música", "electronica", "electrónica",
    "under", "finde",
}


@dataclass
class ResolvedEntity:
    candidate: str
    entity_type: str  # "dj" | "venue" | "genre" | "city"
    entity_id: str
    matched_name: str
    score: float
    matched_slug: str | None = None  # solo para "genre" -- el slug REAL de
    # la tabla genres, para no tener que recalcularlo a mano en el router
    # (name.lower().replace(" ", "-")) y arriesgarse a que no coincida con
    # el slug real si la convencion usada al cargar los generos fue otra.


def _score_expr(sim_fn: str, name_col: str) -> str:
    if sim_fn == "word_similarity":
        # candidato corto primero, nombre largo segundo -- ver comentario en CANDIDATE_TABLES.
        return f"word_similarity(:q, {name_col})"
    return f"similarity({name_col}, :q)"


def resolve_candidate(db: Session, candidate: str, min_score: float = MIN_SCORE) -> list[ResolvedEntity]:
    """
    Busca `candidate` contra djs, venues, genres y cities al mismo tiempo, y
    devuelve TODOS los matches empatados en el mejor puntaje, si ese
    puntaje supera min_score (normalmente una lista de un solo elemento).

    Puede haber más de uno cuando dos filas comparten el nombre exacto --
    caso real detectado: dos venues distintos llamados "Palacio Alsina",
    uno en Buenos Aires y otro en Córdoba. Antes, un LIMIT 1 cortaba ese
    empate de forma arbitraria (sin ningún criterio real, dependía del
    orden interno de Postgres) y podía terminar filtrando por el venue
    equivocado sin que nadie lo notara -- la búsqueda daba 0 resultados
    igual de "válida" que si hubiera encontrado el correcto. Devolver los
    empatados en vez de elegir a ciegas traslada la decisión a
    route_from_segments, que los trata como "cualquiera de estos" en el
    filtro de búsqueda, en vez de apostar a ciegas por uno solo.
    """
    best_type: str | None = None
    best_score: float = -1.0
    best_rows: list = []

    for table, id_col, name_col, entity_type, sim_fn in CANDIDATE_TABLES:
        score_expr = _score_expr(sim_fn, name_col)
        # Para genres, traemos tambien el slug real de la tabla -- lo
        # necesita route_from_segments, y es la fuente de verdad, no algo
        # a recalcular fuera de esta consulta.
        extra_col = ", slug" if table == "genres" else ""
        query = text(f"""
            SELECT {id_col} AS id, {name_col} AS name, {score_expr} AS score{extra_col}
            FROM {table}
            WHERE {score_expr} > 0.1
            ORDER BY score DESC
            LIMIT 10
        """)
        rows = db.execute(query, {"q": candidate}).all()
        if not rows:
            continue
        top_score = float(rows[0].score)
        if top_score > best_score:
            best_score = top_score
            best_type = entity_type
            best_rows = [r for r in rows if abs(float(r.score) - top_score) < 1e-9]
        # Un empate entre tablas DISTINTAS (ej: un venue y una ciudad con
        # exactamente el mismo score) es un caso mucho mas raro y de otra
        # naturaleza -- se resuelve por el orden de CANDIDATE_TABLES, sin
        # cambiar ese comportamiento previo.

    if best_type is None or best_score < min_score:
        return []

    return [
        ResolvedEntity(
            candidate=candidate,
            entity_type=best_type,
            entity_id=str(row.id),
            matched_name=row.name,
            score=best_score,
            matched_slug=(row.slug if best_type == "genre" else None),
        )
        for row in best_rows
    ]


def resolve_candidates(db: Session, candidates: list[str], min_score: float = MIN_SCORE) -> dict:
    """
    Resuelve una lista de candidatos. Devuelve:
      - "resolved": los que matchearon con confianza (tipo, id, nombre real, score)
      - "unresolved": los que no matchearon nada (van como texto libre al vector)
    """
    resolved = []
    unresolved = []
    for c in candidates:
        normalized = c.strip().lower()
        if normalized in IGNORED_CANDIDATES:
            continue
        if normalized in SKIP_ENTITY_MATCH:
            unresolved.append(c)
            continue
        matches = resolve_candidate(db, c, min_score=min_score)
        if matches:
            resolved.extend(matches)
        else:
            unresolved.append(c)
    return {"resolved": resolved, "unresolved": unresolved}