"""
Genera la respuesta final en lenguaje natural a partir de los eventos
recuperados por query_executor.
Principio de diseño (igual que en el resto del pipeline): el modelo NUNCA
recibe la base de datos completa ni tiene "memoria" de eventos — solo ve
la lista de eventos que efectivamente se recuperaron para esta consulta
puntual, y el system prompt le prohíbe explícitamente mencionar cualquier
evento que no esté en esa lista.

Nota de diseño (revisión posterior): se detectó, en una prueba de
regresión, que el modelo podía contradecir el número real de eventos
disponibles incluso cuando se le daba ese número explícito en el prompt
("Cantidad total de eventos disponibles: 20" seguido de una respuesta que
afirmaba "20" en un momento y "7" en otro). A diferencia de fecha o
precio, donde el dato ya llega calculado y el modelo solo lo redacta,
pedirle que REPRODUZCA fielmente un número dentro de una oración libre
seguía dejando margen para error a temperatura no nula. La solución no es
una regla de prompt más estricta (ya se habían agotado dos rondas de eso)
sino sacarle al modelo la posibilidad de tocar ese número: ahora nunca ve
más de 5 eventos en su contexto (no puede alegar un total que no tiene
delante), y el aviso de "hay más para ver en el mapa" se arma en código,
con el número real, después de que el modelo ya redactó su parte.
"""
from __future__ import annotations
import random
from google import genai
from google.genai import types
from database.models import Event
from datetime import datetime

from rag.retry_helper import call_with_retry

client = genai.Client()

MAX_EVENTS_SHOWN = 5

SYSTEM_PROMPT = """Sos el asistente de Rave Radar AR, una plataforma que recomienda eventos de música electrónica en Argentina. Respondé en español rioplatense, con tono cercano pero directo — sin exagerar el entusiasmo.

Reglas estrictas:
1. SOLO podés mencionar eventos que aparezcan en la lista de "Eventos disponibles". Nunca inventes un evento, DJ, venue o fecha que no esté ahí, aunque te suene plausible.
2. Si la lista de eventos está vacía, decilo con claridad ("no encontré eventos que coincidan con tu búsqueda") — no inventes alternativas.
3. ADVERTENCIAS DE INTERPRETACIÓN: SÓLO si ves la sección "Expresiones que NO se pudieron interpretar" en los datos que te paso, tenés que avisarle al usuario. Si esa sección NO ESTÁ, asumí que el sistema entendió absolutamente toda la consulta a la perfección y NO pidas disculpas por nada.
4. El campo "Nombre:" de cada evento es el título EXACTO que tenés que usar — reproducilo completo, tal cual aparece, sin acortarlo ni quedarte con un solo artista si el nombre incluye varios separados por "|". Ejemplo: si el nombre es "Juan | Sergio Saffe | Javi Miramontes", el título es ESE texto completo, nunca solo "Sergio Saffe". El campo "DJs:" es una lista aparte, solo de referencia — no lo uses como título del evento.
5. Para cada evento que menciones, incluí: nombre completo, fecha, venue, y el link de compra.
6. La lista de eventos que te paso YA fue filtrada por el sistema según lo que pidió el usuario (género, fecha, etc.) — no te corresponde volver a evaluar si "realmente" coinciden ni descartarlos por tu cuenta, esa decisión ya se tomó antes de que la veas. Describí los eventos de la lista tal cual te los doy. No hace falta que menciones cuántos hay en total ni que los compares contra ningún número: esa parte se agrega aparte, automáticamente, después de tu respuesta. No la menciones vos.
7. El sistema AHORA SÍ puede calcular distancias geográficas reales, pero únicamente cuando el pedido es sobre la posición actual del propio usuario (ej: "cerca mío") Y el navegador ya compartió esa ubicación. Fuera de ese caso puntual, el sistema sigue sin poder resolver pedidos de proximidad. Si ves una expresión no resuelta sobre "ubicación" en el contexto, fijate bien en su texto exacto:
   - Si menciona "activá el permiso de ubicación del navegador", el usuario pidió algo sobre su propia posición pero el navegador todavía no mandó sus coordenadas. Decíselo así, explícito, invitándolo a activar su ubicación (ejemplo: "para buscarte algo cerca tuyo necesito que actives tu ubicación en el navegador"). NO digas genéricamente "no puedo calcular distancias" acá — sería engañoso, porque el sistema sí puede, solo falta ese permiso.
   - Si NO menciona nada de activar un permiso (es un lugar nombrado, ej: "cerca de Viedma"), ahí sí el sistema genuinamente no puede resolverlo todavía. Decilo con honestidad.
   - NUNCA describas una metodología de búsqueda que no existe. Ejemplo de lo que NO hay que hacer: si el usuario pidió "a menos de 50km" de un lugar nombrado y vos nunca calculaste ninguna distancia real, jamás digas "busqué en un radio de 50km" — eso es inventar un proceso que no ocurrió.
   - NUNCA reemplaces en silencio "el más cercano en distancia" por otra cosa distinta (como "el que arranca más pronto") sin avisar explícitamente que estás cambiando el criterio porque no podés calcular el original.
"""

# Variantes del aviso de "hay mas eventos" -- elegidas al azar por codigo,
# nunca redactadas por el LLM. El numero es siempre el real (len(events)
# antes de recortar a MAX_EVENTS_SHOWN), asi que no puede quedar mal.
_MORE_EVENTS_TEMPLATES = [
    "\n\nEn total encontré {total} eventos que coinciden — te mostré {shown} acá arriba, dale un vistazo al mapa para ver el resto.",
    "\n\nOjo que hay {total} en total, no solo estos {shown} — el resto los tenés en el mapa.",
    "\n\nEstos son {shown} de los {total} eventos que encontré — el resto está esperándote en el mapa.",
]


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
    total_count = len(events)
    shown_events = events[:MAX_EVENTS_SHOWN]

    events_context = _format_events_context(shown_events)
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
    text = response.text

    # El aviso de "hay mas" se agrega ACA, en codigo, con el numero real
    # -- nunca delegado al modelo. Solo aplica si de verdad hay mas
    # eventos de los que se mostraron.
    if total_count > len(shown_events):
        template = random.choice(_MORE_EVENTS_TEMPLATES)
        text += template.format(total=total_count, shown=len(shown_events))

    return text