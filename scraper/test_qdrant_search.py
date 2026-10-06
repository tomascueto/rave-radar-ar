# scraper/test_qdrant_search.py
"""
Prueba de humo para Qdrant: no solo confirma que hay puntos cargados,
confirma que BUSCAR devuelve algo con sentido. Corre una consulta real
contra la colección 'events' y muestra los resultados con su score, para
que los mires y confirmes a ojo si el orden tiene sentido.

Uso:
    python -m scraper.test_qdrant_search "algo under y groovy"
    python -m scraper.test_qdrant_search "fiesta de techno"
"""
import os
import sys

from dotenv import load_dotenv
from google import genai
from qdrant_client import QdrantClient

load_dotenv()

COLLECTION_NAME = "events"
# Mismo modelo/dimension que scraper/index_events_qdrant.py y
# rag/query_executor.py -- tienen que coincidir exactamente.
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIM = 768


def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: python -m scraper.test_qdrant_search "tu consulta de prueba"')
        sys.exit(1)

    query_text = sys.argv[1]

    url = os.getenv("QDRANT_URL")
    if not url:
        raise RuntimeError("QDRANT_URL no está seteada en esta sesión -- revisá las variables de entorno.")

    client = QdrantClient(url=url, api_key=os.getenv("QDRANT_API_KEY"))

    count = client.count(COLLECTION_NAME).count
    print(f"Puntos totales en la colección '{COLLECTION_NAME}': {count}")
    if count == 0:
        print("La colección está vacía -- no hay nada que buscar todavía. Corré la indexación primero.")
        sys.exit(1)

    genai_client = genai.Client()

    # task_type="RETRIEVAL_QUERY", no RETRIEVAL_DOCUMENT -- es el texto que
    # se busca, no el que se indexa (ver rag/query_executor.py).
    response = genai_client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=[query_text],
        config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": EMBEDDING_DIM},
    )
    query_vector = response.embeddings[0].values

    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=5,
        with_payload=True,
    )

    print(f"\nResultados para: \"{query_text}\"\n")
    for i, point in enumerate(results.points, 1):
        name = point.payload.get("name", "(sin nombre)")
        genres = ", ".join(point.payload.get("genre_slugs", [])) or "(sin género)"
        event_type = point.payload.get("event_type") or "?"
        print(f"{i}. [{point.score:.3f}] {name} -- {genres} [{event_type}]")


if __name__ == "__main__":
    main()