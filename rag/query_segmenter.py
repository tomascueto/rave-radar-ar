import os
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

from rag.retry_helper import call_with_retry

load_dotenv()
client = genai.Client()

class QuerySegments(BaseModel):
    entity_candidates: list[str] = Field(description="Nombres propios (DJs, venues, géneros, ciudades) mencionados tal cual aparecen.")
    date_expr: str | None = Field(description="Expresión de fecha si la hay, o null.")
    price_expr: str | None = Field(description="Expresión de precio tal cual aparece en el texto. null si no menciona precio, O si dice explícitamente que no le importa (ej: 'cualquier precio', 'no importa cuánto', 'sin límite de presupuesto', 'lo que sea') — en esos casos no hay ninguna restricción real que interpretar, es lo mismo que no haber mencionado precio en absoluto.")
    wants_cheap: bool = Field(
        description="true si el usuario busca algo económico de CUALQUIER forma que lo exprese (barato, sin gastar de más, algo módico). false si no menciona eso o si da un número explícito."
    )
    location_expr: str | None = Field(
        description="Expresión de proximidad o distancia geográfica si la hay, tal cual aparece en el texto (ej: 'cerca de General Roca', 'a menos de 50km de mi ubicación', 'cerca mío', 'el más cercano en distancia'). null si la consulta no pide nada de cercanía/distancia geográfica — mencionar una ciudad o zona sin pedir 'cerca' o una distancia NO cuenta como esto."
    )
    is_self_location: bool = Field(
        description="true SOLO si location_expr se refiere a la posición actual del propio usuario (ej: 'cerca mío', 'cerca de mi ubicación', 'el más cercano a donde estoy', 'a menos de 10km de acá'). false si location_expr se refiere a un lugar nombrado por el usuario (ej: 'cerca de General Roca', 'cerca de Palermo'), o si location_expr es null."
    )
    free_text: str = Field(description="Descripciones de onda o estilo. Cadena vacía si no hay.")


def _format_history(history: list[dict]) -> str:
    lines = []
    for turn in history:
        speaker = "Usuario" if turn["role"] == "user" else "Asistente"
        lines.append(f"{speaker}: {turn['content']}")
    return "\n".join(lines)


def segment_query(text: str, history: list[dict] | None = None) -> dict:
    history_block = ""
    if history:
        history_block = f"""
Historial reciente de la conversación (más antiguo primero, puede estar vacío si es el primer mensaje):
{_format_history(history)}

La consulta actual puede ser una continuación o un ajuste de lo anterior — por ejemplo, "¿y alguno más barato?" después de haber preguntado por "eventos de techno este finde" significa: eventos de techno de este finde, pero además baratos. Tu segmentación debe reflejar la intención COMPLETA y VIGENTE en este momento, combinando lo que sigue aplicando del historial con lo nuevo de la consulta actual. Si la consulta actual cambia de tema (por ejemplo, pasa de techno a otro género sin relación con lo anterior), no arrastres restricciones viejas que ya no correspondan — usá tu criterio sobre qué sigue vigente y qué no, igual que lo haría una persona siguiendo la conversación.
"""

    prompt = f"""Analizá esta consulta de un usuario buscando eventos de música electrónica en Argentina:
    "{text}"
    {history_block}
    Separá la consulta SIN interpretar qué tipo de cosa es cada nombre propio.
    """

    response = call_with_retry(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
            response_schema=QuerySegments,
        )
    )

    return QuerySegments.model_validate_json(response.text).model_dump()