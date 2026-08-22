"""
Segmenta una consulta en lenguaje natural en piezas candidatas, SIN intentar
clasificar qué es cada una (eso lo hace entity_resolver.py contra Postgres).
El LLM solo trocea texto, nunca decide si algo es DJ/venue/género — evita
repetir el riesgo de alucinación que ya identificamos en geocodificación.
"""

import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
client = genai.Client()


def segment_query(text: str) -> dict:
    prompt = f"""Analizá esta consulta de un usuario buscando eventos de música electrónica en Argentina:

"{text}"

Separá la consulta en estas partes, SIN interpretar qué tipo de cosa es cada nombre propio (no digas si es DJ, venue o género, solo extraé el texto):

- entity_candidates: lista de nombres propios o términos específicos mencionados (nombres de DJs, venues, géneros musicales, ciudades) tal cual aparecen en el texto
- date_expr: expresión de fecha si la hay (ej. "este sábado", "el finde que viene"), o null
- price_expr: expresión de precio si la hay (ej. "barato", "menos de 20000"), o null
- free_text: cualquier descripción de "onda" o estilo que no sea un nombre propio (ej. "under y oscuro"), o cadena vacía si no hay

Respondé ÚNICAMENTE este JSON, sin texto adicional:
{{"entity_candidates": [], "date_expr": null, "price_expr": null, "free_text": ""}}"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.1),
    )
    text_out = response.text.strip()
    if text_out.startswith("```"):
        text_out = text_out.split("```")[1]
        if text_out.startswith("json"):
            text_out = text_out[4:]
    return json.loads(text_out.strip())