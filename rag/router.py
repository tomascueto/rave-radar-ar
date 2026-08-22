"""
Router: decide si una consulta se resuelve con SQL directo (todo estructurado,
sin texto descriptivo remanente) o combinando Qdrant (filtro + vector) cuando
queda contenido semántico libre.

Pipeline completo:
  1. segment_query()      -> LLM trocea la consulta (no clasifica nada)
  2. resolve_candidates()  -> Postgres verifica qué es cada candidato (pg_trgm)
  3. interpret_date/price  -> interpretación local, sin LLM, de expresiones
                               relativas de fecha y precio
  4. route()               -> decide estrategia y arma los filtros finales

Principio de diseño (igual que en geocodificación y en el resolver de
entidades): ningún componente le pide a un LLM que calcule o adivine un
valor que tiene una respuesta objetivamente verificable. Fechas y precios
se resuelven con lógica determinística; el LLM solo se usa para tareas de
lenguaje que genuinamente lo requieren (segmentar texto libre).
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from dateparser.search import search_dates
from sqlalchemy import text
from sqlalchemy.orm import Session

from rag.entity_resolver import resolve_candidates
from rag.query_segmenter import segment_query

CHEAP_PERCENTILE_QUERY = """
    SELECT percentile_cont(0.33) WITHIN GROUP (ORDER BY max_price) AS umbral
    FROM events
    WHERE is_active = true AND max_price IS NOT NULL
"""
CHEAP_STEMS = ["barat", "econom", "accesible"]

_ORDINALES = {
    "primer": 1, "primero": 1, "segundo": 2, "tercer": 3, "tercero": 3,
    "cuarto": 4, "quinto": 5, "ultimo": -1, "último": -1,
}
_DIAS = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2, "jueves": 3,
    "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6,
}
_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}
_ORDINAL_DATE_RE = re.compile(
    r"(primer|primero|segundo|tercer|tercero|cuarto|quinto|ultimo|último)\s+"
    r"(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\s+de\s+"
    r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|"
    r"octubre|noviembre|diciembre)"
)


@dataclass
class RouteResult:
    strategy: str  # "sql" | "qdrant"
    filters: dict = field(default_factory=dict)
    semantic_text: str | None = None


def _nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> datetime | None:
    """n-ésima ocurrencia (1-indexed) de `weekday` en el mes/año dado. n=-1 -> última."""
    cal = calendar.Calendar()
    dias = [d for d in cal.itermonthdates(year, month)
            if d.month == month and d.weekday() == weekday]
    if n == -1:
        return datetime.combine(dias[-1], datetime.min.time()) if dias else None
    if 1 <= n <= len(dias):
        return datetime.combine(dias[n - 1], datetime.min.time())
    return None


def _interpret_ordinal_date(expr: str, base: datetime) -> datetime | None:
    """
    Calcula fechas del tipo 'el segundo sábado de septiembre' o 'último
    viernes de octubre' con aritmética de calendario exacta (sin LLM, sin
    ambigüedad). Se usa como fallback cuando search_dates() no reconoce
    la expresión.
    """
    match = _ORDINAL_DATE_RE.search(expr.lower())
    if not match:
        return None

    ord_word, dia_word, mes_word = match.groups()
    n = _ORDINALES[ord_word]
    weekday = _DIAS[dia_word]
    month = _MESES[mes_word]

    result = _nth_weekday_of_month(base.year, month, weekday, n)
    if result and result < base:
        result = _nth_weekday_of_month(base.year + 1, month, weekday, n)
    return result


def interpret_date(date_expr: str | None) -> tuple[datetime, datetime] | None:
    """
    Convierte una expresión relativa de fecha en un rango (inicio, fin).
    Dos capas, ambas determinísticas:
      1. search_dates() (dateparser) — cubre expresiones simples
         ("este sábado", "mañana", "el 5 de octubre").
      2. Cálculo ordinal propio — cubre "el segundo sábado de septiembre",
         "último viernes de octubre", que dateparser no reconoce.
    Si ninguna resuelve la expresión, devuelve None: el filtro simplemente
    no se aplica, en vez de forzar una interpretación dudosa.
    """
    if not date_expr:
        return None

    base = datetime.now()
    results = search_dates(
        date_expr,
        languages=["es"],
        settings={"PREFER_DATES_FROM": "future", "RELATIVE_BASE": base},
    )
    parsed = results[0][1] if results else _interpret_ordinal_date(date_expr, base)

    if not parsed:
        return None

    start = parsed.replace(hour=0, minute=0, second=0)
    end = start + timedelta(days=1)
    return start, end


def interpret_price(price_expr: str | None, db: Session) -> float | None:
    if not price_expr:
        return None

    numbers = re.findall(r"\d[\d.,]*\d|\d", price_expr.replace(".", "").replace(",", ""))
    if numbers:
        try:
            return float(numbers[0])
        except ValueError:
            pass

    if any(stem in price_expr.lower() for stem in CHEAP_STEMS):
        row = db.execute(text(CHEAP_PERCENTILE_QUERY)).first()
        if row and row.umbral:
            return float(row.umbral)

    return None


def route_from_segments(db: Session, segmented: dict) -> RouteResult:
    """
    Toma un dict ya segmentado (el resultado de segment_query, real o de
    prueba) y aplica toda la lógica de ruteo: resolución de entidades contra
    Postgres, interpretación de fecha/precio, y decisión de estrategia.

    Separada de route_query() a propósito: esta función NO llama a ningún
    LLM, así que se puede testear/iterar libremente (fechas, precios,
    decisión de ruteo) sin consumir cuota de Gemini. Útil sobre todo durante
    desarrollo, donde el cuello de botella real suele ser la lógica
    determinística, no la segmentación (que ya se probó y funciona).
    """
    resolved = resolve_candidates(db, segmented["entity_candidates"])

    filters: dict = {}
    for r in resolved["resolved"]:
        if r.entity_type == "dj":
            filters.setdefault("dj_names", []).append(r.matched_name)
        elif r.entity_type == "venue":
            filters["venue_id"] = r.entity_id
        elif r.entity_type == "genre":
            filters.setdefault("genre_slugs", []).append(r.matched_name.lower().replace(" ", "-"))
        elif r.entity_type == "city":
            filters["city_id"] = r.entity_id

    date_range = interpret_date(segmented.get("date_expr"))
    if segmented.get("date_expr") and not date_range:
        filters.setdefault("unresolved_expressions", []).append(
            f"fecha: '{segmented['date_expr']}'"
        )
    if date_range:
        filters["date_from_start"], filters["date_from_end"] = date_range

    max_price = interpret_price(segmented.get("price_expr"), db)
    if segmented.get("price_expr") and max_price is None:
        filters.setdefault("unresolved_expressions", []).append(
            f"precio: '{segmented['price_expr']}'"
        )
    if max_price is not None:
        filters["max_price"] = max_price

    free_text_parts = [segmented.get("free_text", "")] + resolved["unresolved"]
    semantic_text = " ".join(p for p in free_text_parts if p).strip()

    if not semantic_text:
        return RouteResult(strategy="sql", filters=filters)
    return RouteResult(strategy="qdrant", filters=filters, semantic_text=semantic_text)


def route_query(db: Session, query: str) -> RouteResult:
    """Version 'productiva': segmenta con el LLM real y despues rutea."""
    segmented = segment_query(query)
    return route_from_segments(db, segmented)