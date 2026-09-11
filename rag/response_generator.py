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

Nota adicional: el mismo principio aplica no solo a "no inventar eventos
que no existen", sino tambien a "no editar/recortar silenciosamente datos
reales que si existen" (ej. reducir un nombre de evento con varios artistas
a uno solo). Ver la etiqueta explicita "Nombre:" en _format_events_context
y la Regla 4 del prompt.
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
4. El campo "Nombre:" de cada evento es el título EXACTO que tenés que usar — reproducilo completo, tal cual aparece, sin acortarlo ni quedarte con un solo artista si el nombre incluye varios separados por "|". Ejemplo: si el nombre es "Juan | Sergio Saffe | Javi Miramontes", el título es ESE texto completo, nunca solo "Sergio Saffe". El campo "DJs:" es una lista aparte, solo de referencia — no lo uses como título del evento.
5. Para cada evento que menciones, incluí: nombre completo, fecha, venue, y el link de compra.
6. No repitas toda la lista si son muchos eventos — elegí los 3-5 más relevantes para el texto. Si la "Cantidad total de eventos disponibles" es MAYOR a la cantidad que elegiste mencionar:
   - Tu PRIMERA frase tiene que anunciar el número TOTAL real — nunca la cantidad que vas a mostrar. Ejemplo CORRECTO: "Encontré 8 opciones para tu búsqueda — te dejo estas 4 acá". Ejemplo INCORRECTO (no hagas esto): "Encontré estas 4 opciones..." (y recién más abajo aclarás que en realidad hay 8) — decir el número chico primero y el número real después confunde, aunque técnicamente ambas frases sean ciertas.
   - SIEMPRE tenés que dejar en claro, en algún punto de la respuesta, que hay más eventos disponibles para ver en el mapa además de los que mencionás acá — no hace falta una frase fija ni repetir siempre las mismas palabras, alcanza con que se entienda de alguna forma natural.
   Usá siempre el número real de la "Cantidad total de eventos disponibles", nunca cuentes vos la lista a ojo. Si mencionás absolutamente todos los eventos disponibles, no hace falta aclarar nada de esto.
7. El sistema NO tiene ninguna capacidad de calcular distancias geográficas reales entre lugares (no existe ningún cálculo de "a X km de distancia" en el pipeline). Si el usuario pide algo por proximidad geográfica:
   - NUNCA describas una metodología de búsqueda que no existe. Ejemplo de lo que NO hay que hacer: si el usuario pidió "a menos de 50km" y vos nunca calculaste ninguna distancia real, jamás digas "busqué en un radio de 50km" — eso es inventar un proceso que no ocurrió.
   - NUNCA reemplaces en silencio "el más cercano en distancia" por otra cosa distinta (como "el que arranca más pronto") sin avisar explícitamente que estás cambiando el criterio porque no podés calcular el original.
   - En cambio, decí con honestidad que el sistema no puede calcular distancias geográficas todavía.
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
            f"- Nombre: {ev.name} | Fecha: {ev.date_from.strftime('%d/%m/%Y %H:%M')} | "
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
Cantidad total de eventos disponibles: {len(events)}
    
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