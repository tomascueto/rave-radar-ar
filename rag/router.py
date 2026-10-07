"""
Router: decide si una consulta se resuelve con SQL directo (todo estructurado,
sin texto descriptivo remanente) o combinando Qdrant (filtro + vector) cuando
queda contenido semántico libre.

Pipeline completo:
  1. segment_query()      -> LLM trocea la consulta Y clasifica (nunca
                              calcula) los rangos de fecha amplios
  2. resolve_candidates()  -> Postgres verifica qué es cada candidato (pg_trgm)
  3. interpret_date/price  -> interpretación local, sin LLM, de expresiones
                               relativas de fecha y precio
  4. route()               -> decide estrategia y arma los filtros finales

Principio de diseño (igual que en geocodificación y en el resolver de
entidades): ningún componente le pide a un LLM que calcule o adivine un
valor que tiene una respuesta objetivamente verificable. Fechas, precios y
distancia se resuelven con lógica determinística; el LLM solo se usa para
tareas de lenguaje que genuinamente lo requieren (segmentar texto libre,
distinguir un lugar nombrado de un pedido sobre la propia posición, y
clasificar una expresión de fecha AMPLIA en una categoría cerrada --
weekend/month/weeks/year, ver date_range_hint en query_segmenter.py --
sin que el LLM calcule ninguna fecha puntual él mismo: eso lo sigue
haciendo interpret_date, siempre).

date_range_hint existe porque depender de que el texto contenga una
palabra clave exacta ("año", "mes"...) es inherentemente incompleto -- un
caso real: "este año" no tenía ningún caso en _interpret_broad_ranges y
caía al parser de fechas puntuales, que lo leía como "hoy". El LLM
entiende CUALQUIER forma de decir lo mismo en español rioplatense
("durante 2026", "antes de que termine el año"...); el matching de texto
(_interpret_weekend/_interpret_broad_ranges) se mantiene como red de
seguridad para cuando el hint no vino.
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

DEFAULT_DISTANCE_KM = 10.0

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
_DISTANCE_KM_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*km")


@dataclass
class RouteResult:
    strategy: str  # "sql" | "qdrant" | "empty"
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

def _weekend_range(base: datetime, next_weekend: bool = False) -> tuple[datetime, datetime]:
    """
    Calculo puro del rango horario de un finde (viernes 00:00 a lunes
    08:00) -- NO decide si la expresión del usuario habla de un finde,
    eso lo hacen por separado _interpret_weekend (busca "finde" en el
    texto) y _range_for_hint (confía en la clasificación del LLM). Separar
    el cálculo del gate de texto es lo que permite que el hint del LLM
    cubra frases como "sábado y domingo" que no contienen la palabra
    "finde" y antes se perdían.
    """
    # Python weekdays: 0=Lunes, 4=Viernes, 5=Sábado, 6=Domingo
    # Si hoy es de Lunes a Viernes, buscamos el viernes de esta semana
    if base.weekday() <= 4:
        start = base + timedelta(days=4 - base.weekday())
    elif base.weekday() == 5:  # Si ya es Sábado, el "finde" empezó ayer
        start = base - timedelta(days=1)
    else:  # Si ya es Domingo, el "finde" empezó hace dos días
        start = base - timedelta(days=2)

    start = start.replace(hour=0, minute=0, second=0, microsecond=0)

    # En la joda, el finde cubre Viernes, Sábado y Domingo.
    # Termina el Lunes a las 08:00 AM.
    end = start + timedelta(days=3, hours=8)

    if next_weekend:
        start += timedelta(days=7)
        end += timedelta(days=7)

    return start, end


def _interpret_weekend(expr: str, base: datetime) -> tuple[datetime, datetime] | None:
    """Calcula el rango de fechas para 'este finde' o 'el finde que viene'."""
    expr = expr.lower()
    if "finde" not in expr and "fin de semana" not in expr:
        return None

    # Si el usuario pide "el finde que viene", simplemente pateamos todo 7 días
    next_weekend = "viene" in expr or "proximo" in expr or "próximo" in expr
    return _weekend_range(base, next_weekend=next_weekend)

# Dias hacia adelante para cada categoria amplia que clasifica el LLM
# (date_range_hint) -- "weekend" no esta aca porque su calculo no es un
# simple forward-window, tiene su propia logica en _range_for_hint.
_BROAD_RANGE_DAYS = {"month": 30, "weeks": 21, "year": 365}


def _range_for_hint(hint: str, date_expr: str | None, base: datetime) -> tuple[datetime, datetime] | None:
    """
    Traduce la categoria que clasifico el LLM (date_range_hint) a un rango
    de fechas real -- el LLM solo eligio la categoria (entender lenguaje
    natural variado, lo que hace bien), toda la aritmetica sigue siendo
    código determinístico (lo que el LLM haria mal: calcular fechas).

    weekend usa _weekend_range directo (NO _interpret_weekend) -- a
    propósito, para no depender de que date_expr contenga literalmente
    "finde"/"fin de semana". El matiz de "el finde que viene" vs "este
    finde" se detecta aparte, sobre el mismo date_expr, pero sin el gate
    que bloquearía algo como "sábado y domingo" (el LLM ya nos dijo que
    es un finde con el hint; no hace falta volver a confirmarlo buscando
    la palabra "finde" en el texto).
    """
    if hint == "weekend":
        expr_lower = (date_expr or "").lower()
        next_weekend = "viene" in expr_lower or "proximo" in expr_lower or "próximo" in expr_lower
        return _weekend_range(base, next_weekend=next_weekend)

    days = _BROAD_RANGE_DAYS.get(hint)
    if days is None:
        return None
    start = base.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=days)


def interpret_date(
    date_expr: str | None, date_range_hint: str | None = None
) -> tuple[datetime, datetime] | None:
    base = datetime.now()

    # 0. Prioridad: la clasificacion del LLM (date_range_hint), si vino.
    # Cubre cualquier forma de decir "este año"/"este finde"/etc. en vez
    # de depender de que el texto contenga una palabra clave exacta -- ver
    # el bug real que motivo esto: "este año" no tenia ningun caso en
    # _interpret_broad_ranges y caia a dateparser, que lo leia como "hoy".
    if date_range_hint:
        hinted = _range_for_hint(date_range_hint, date_expr, base)
        if hinted:
            return hinted

    if not date_expr:
        return None

    # 1. Atajar el "finde" (nuestra lógica dura) -- red de seguridad si el
    # hint vino null pero el texto igual dice "finde" clarito.
    weekend_range = _interpret_weekend(date_expr, base)
    if weekend_range:
        return weekend_range

    # 2. Atajar rangos amplios ("próximas semanas", "este mes") -- misma
    # red de seguridad que el punto 1, para cuando el hint no vino.
    broad_range = _interpret_broad_ranges(date_expr, base)
    if broad_range:
        return broad_range

    # 3. Recién acá usamos dateparser para fechas exactas ("mañana", "el 15 de octubre")
    results = search_dates(
        date_expr,
        languages=["es"],
        settings={"PREFER_DATES_FROM": "future", "RELATIVE_BASE": base},
    )
    parsed = results[0][1] if results else _interpret_ordinal_date(date_expr, base)

    if not parsed:
        return None

    start = parsed.replace(hour=0, minute=0, second=0)
    end = start + timedelta(days=1, hours=8)
    return start, end


def interpret_price(price_expr: str | None, wants_cheap: bool, db: Session) -> float | None:
    if not price_expr and not wants_cheap:
        return None

    if price_expr:
        numbers = re.findall(r"\d[\d.,]*\d|\d", price_expr.replace(".", "").replace(",", ""))
        if numbers:
            try:
                return float(numbers[0])
            except ValueError:
                pass

    if wants_cheap:
        row = db.execute(text(CHEAP_PERCENTILE_QUERY)).first()
        if row and row.umbral:
            return float(row.umbral)

    return None


def interpret_distance_km(location_expr: str) -> float:
    """
    Extrae un número de kilómetros de la expresión, si el usuario dio uno
    explícito (ej: 'a menos de 50km' -> 50.0). Si no especificó ningún
    número (ej: 'cerca mío', sin más), se usa un radio por defecto
    razonable -- mismo criterio que el resto del proyecto: nunca se le
    pide a un LLM que calcule o invente el número; si no hay dato
    explícito en el texto, se define un valor determinístico en código,
    no algo que el modelo "estime".
    """
    match = _DISTANCE_KM_RE.search(location_expr.lower())
    if match:
        try:
            return float(match.group(1).replace(",", "."))
        except ValueError:
            pass
    return DEFAULT_DISTANCE_KM


def _interpret_broad_ranges(expr: str, base: datetime) -> tuple[datetime, datetime] | None:
    """Calcula rangos de tiempo amplios que dateparser suele romper.

    Caso real detectado: "este año" sin un caso explicito aca caia al
    dateparser generico (paso 3 de interpret_date), que lo interpretaba
    como "hoy" -- un evento de Michael Bibi en noviembre no aparecia para
    una consulta de octubre que pedia "este año", pese a resolver bien el
    DJ. Mismo criterio que "mes"/"semanas": una ventana hacia adelante
    desde hoy, no alineada al 31/12 -- simple y consistente con el resto
    de esta funcion."""
    expr = expr.lower()
    start = base.replace(hour=0, minute=0, second=0, microsecond=0)

    if "año" in expr:
        # Ventana generosa hacia adelante, no acotada al 31/12 -- "este
        # año" en la practica significa "de aca en mas este año", y
        # cortar justo en diciembre no aporta nada.
        end = start + timedelta(days=365)
        return start, end

    if "semanas" in expr or "mes" in expr:
        if "mes" in expr:
            # Si pide "este mes" o "próximo mes", abrimos la ventana a 30 días
            end = start + timedelta(days=30)
        elif "semanas" in expr:
            # Si pide "próximas semanas", abrimos la ventana a 21 días (3 semanas)
            end = start + timedelta(days=21)
        return start, end

    return None

def route_from_segments(
    db: Session,
    segmented: dict,
    user_lat: float | None = None,
    user_lng: float | None = None,
) -> RouteResult:
    """
    Toma un dict ya segmentado (el resultado de segment_query, real o de
    prueba) y aplica toda la lógica de ruteo: resolución de entidades contra
    Postgres, interpretación de fecha/precio/distancia, y decisión de
    estrategia.

    user_lat/user_lng son opcionales -- vienen del navegador del usuario
    (geolocalización), nunca de geocodificar texto. Si la consulta pide
    "cerca mío" y estas coordenadas están presentes, se resuelve con un
    filtro de distancia real; si no están, se corta la búsqueda igual que
    con un lugar nombrado sin geocodificar, pero avisando específicamente
    que falta activar el permiso de ubicación.

    Separada de route_query() a propósito: esta función NO llama a ningún
    LLM, así que se puede testear/iterar libremente (fechas, precios,
    distancias, decisión de ruteo) sin consumir cuota de Gemini.
    """
    resolved = resolve_candidates(db, segmented["entity_candidates"])

    filters: dict = {}
    for r in resolved["resolved"]:
        if r.entity_type == "dj":
            filters.setdefault("dj_names", []).append(r.matched_name)
        elif r.entity_type == "venue":
            # Lista, no un solo valor -- ver comentario en
            # ResolvedEntity/resolve_candidate: puede haber mas de un
            # venue empatado (mismo nombre, distinta ciudad), y filtrar
            # por "cualquiera de estos" es mas seguro que elegir uno a
            # ciegas.
            filters.setdefault("venue_ids", []).append(r.entity_id)
        elif r.entity_type == "genre":
            # Slug REAL de la tabla genres (matched_slug), no recalculado a
            # mano -- ver comentario en ResolvedEntity.matched_slug. El
            # fallback solo cubre el caso defensivo de que, por algun
            # motivo, no venga poblado.
            slug = r.matched_slug or r.matched_name.lower().replace(" ", "-")
            filters.setdefault("genre_slugs", []).append(slug)
        elif r.entity_type == "city":
            filters["city_id"] = r.entity_id

    date_range = interpret_date(segmented.get("date_expr"), segmented.get("date_range_hint"))
    if (segmented.get("date_expr") or segmented.get("date_range_hint")) and not date_range:
        filters.setdefault("unresolved_expressions", []).append(
            f"fecha: '{segmented.get('date_expr')}'"
        )
    if date_range:
        filters["date_from_start"], filters["date_from_end"] = date_range

    max_price = interpret_price(segmented.get("price_expr"), segmented.get("wants_cheap", False), db)
    if segmented.get("price_expr") and max_price is None:
        filters.setdefault("unresolved_expressions", []).append(
            f"precio: '{segmented['price_expr']}'"
        )
    if max_price is not None:
        filters["max_price"] = max_price

    # Ubicación: dos casos bien distintos bajo el mismo location_expr.
    # - Lugar nombrado ("cerca de General Roca"): seguimos sin poder
    #   geocodificarlo en tiempo real (Etapa 2, pendiente) -- corta la
    #   búsqueda, igual que antes.
    # - Posición propia ("cerca mío"): si el navegador ya mandó
    #   coordenadas, se resuelve de verdad con un filtro de distancia
    #   real (PostGIS, en query_executor). Si todavía no las mandó,
    #   corta la búsqueda con un mensaje que pide activar el permiso, en
    #   vez de la limitación genérica de antes.
    location_expr = segmented.get("location_expr")
    location_cuts_search = False

    if location_expr:
        is_self_location = segmented.get("is_self_location", False)
        if is_self_location and user_lat is not None and user_lng is not None:
            filters["user_lat"] = user_lat
            filters["user_lng"] = user_lng
            filters["max_distance_km"] = interpret_distance_km(location_expr)
        elif is_self_location:
            filters.setdefault("unresolved_expressions", []).append(
                f"ubicación: '{location_expr}' (activá el permiso de ubicación del navegador para resolver esto)"
            )
            location_cuts_search = True
        else:
            filters.setdefault("unresolved_expressions", []).append(
                f"ubicación: '{location_expr}'"
            )
            location_cuts_search = True

    free_text_parts = [segmented.get("free_text", "")] + resolved["unresolved"]
    semantic_text = " ".join(p for p in free_text_parts if p).strip()

    if location_cuts_search:
        return RouteResult(strategy="empty", filters=filters)

    if not semantic_text:
        return RouteResult(strategy="sql", filters=filters)
    return RouteResult(strategy="qdrant", filters=filters, semantic_text=semantic_text)


def route_query(
    db: Session, query: str, user_lat: float | None = None, user_lng: float | None = None,
) -> RouteResult:
    """Version 'productiva': segmenta con el LLM real y despues rutea."""
    segmented = segment_query(query)
    return route_from_segments(db, segmented, user_lat=user_lat, user_lng=user_lng)