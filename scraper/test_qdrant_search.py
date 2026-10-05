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
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer

load_dotenv()

COLLECTION_NAME = "events"
EMBEDDING_MODEL = "intfloat/multilingual-e5-large"


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

    print(f"\nCargando el modelo de embeddings ({EMBEDDING_MODEL})… puede tardar unos segundos.")
    model = SentenceTransformer(EMBEDDING_MODEL)

    # Prefijo "query: " -- el mismo modelo E5 usa un prefijo distinto para
    # texto que se busca que para texto que se indexa ("passage: "). Mezclar
    # los dos prefijos, o no usar ninguno, degrada la calidad del resultado.
    query_vector = model.encode(f"query: {query_text}").tolist()

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