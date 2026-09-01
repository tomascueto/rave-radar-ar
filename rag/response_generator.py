"""
Genera la respuesta final en lenguaje natural a partir de los eventos
recuperados por query_executor.
Principio de diseño (igual que en el resto del pipeline): el modelo NUNCA
recibe la base de datos completa ni tiene "memoria" de eventos — solo ve
la lista de eventos que efectivamente se recuperaron para esta consulta
puntual, y el system prompt le prohíbe explícitamente mencionar cualquier
evento que no esté en esa lista. Esto evita que el paso final de
generación reintroduzca el riesgo de alucinación ya identificado y
mitigado en geocodificación (Sección 4.4.3) y en el resolver de entidades.
"""
from __future__ import annotations
from google import genai
from google.genai import types
from database.models import Event
from datetime import datetime

from rag.retry_helper import call_with_retry

client = genai.Client()

SYSTEM_PROMPT = """Sos el asistente de Rave Radar AR, una plataforma que recomienda eventos de música electrónica en Argentina. Respondé en español rioplatense, con tono cercano pero directo — sin exagerar el entusiasmo.

Reglas estrictas:
1. SOLO podés mencionar eventos que aparezcan en la lista de "Eventos disponibles". Nunca inventes un evento, DJ, venue o fecha que no esté ahí, aunque te suene plausible.
2. Si la lista de eventos está vacía, decilo con claridad ("no encontré eventos que coincidan con tu búsqueda") — no inventes alternativas.
3. ADVERTENCIAS DE INTERPRETACIÓN: SÓLO si ves la sección "Expresiones que NO se pudieron interpretar" en los datos que te paso, tenés que avisarle al usuario. Si esa sección NO ESTÁ, asumí que el sistema entendió absolutamente toda la consulta a la perfección y NO pidas disculpas por nada.
4. Para cada evento que menciones, incluí: nombre, fecha, venue, y el link de compra.
5. No repitas toda la lista si son muchos eventos — elegí los 3-5 más relevantes.
"""


def _format_events_context(events: list[Event]) -> str:
    if not events:
        return "(No se encontraron eventos que coincidan con la búsqueda.)"
    lines = []

    for ev in events:
        venue_name = ev.venue.name if ev.venue else "Venue no especificado"
        djs = ", ".join(ed.dj.name for ed in ev.djs if ed.dj) or "Line-up no especificado"
        precio = f"desde ${ev.min_price:,.0f}" if ev.min_price else "precio no informado"
        lines.append(
            f"- {ev.name} | {ev.date_from.strftime('%d/%m/%Y %H:%M')} | "
            f"Venue: {venue_name} | DJs: {djs} | {precio} | "
            f"Ticket: {ev.ticket_url or 'no disponible'}"
        )
    return "\n".join(lines)

def generate_response(
    user_query: str,
    events: list[Event],
    unresolved_expressions: list[str] | None = None,
) -> str:
    events_context = _format_events_context(events)
    unresolved_note = ""
    if unresolved_expressions:
        unresolved_note = (
            "\n\nExpresiones que NO se pudieron interpretar (mencionalo al usuario): "
            + "; ".join(unresolved_expressions)
        )

    hoy = datetime.now().strftime("%A %d/%m/%Y")

    prompt = f"""Fecha actual del sistema: {hoy}
    
Consulta del usuario: "{user_query}"

Eventos disponibles (ÚNICAMENTE estos, no inventes otros):
{events_context}{unresolved_note}

Redactá la respuesta para el usuario."""
    response = call_with_retry(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.4,
        ),
    )
    return response.text