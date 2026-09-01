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
    price_expr: str | None = Field(description="Expresión de precio tal cual aparece en el texto, o null.")
    wants_cheap: bool = Field(
        description="true si el usuario busca algo económico de CUALQUIER forma que lo exprese (barato, sin gastar de más, algo módico). false si no menciona eso o si da un número explícito."
    )
    free_text: str = Field(description="Descripciones de onda o estilo. Cadena vacía si no hay.")

def segment_query(text: str) -> dict:
    prompt = f"""Analizá esta consulta de un usuario buscando eventos de música electrónica en Argentina:
    "{text}"
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