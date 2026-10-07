"""
Crea la colección "events" en Qdrant -- local o Cloud, según QDRANT_URL en
el .env. Pensado para correrse una sola vez contra una instancia nueva,
pero es seguro correrlo de nuevo: si la colección ya existe, no la toca
y no falla.

Tamaño del vector: 768 -- output_dimensionality pedido explícitamente al
generar embeddings con gemini-embedding-001 (ver EMBEDDING_MODEL/
EMBEDDING_DIM en scraper/index_events_qdrant.py y rag/query_executor.py,
que tienen que coincidir exactamente con este número). El default del
modelo es 3072; achicarlo a 768 es deliberado para mantener el vector
manejable en Qdrant.

Distancia: coseno -- es la métrica recomendada para gemini-embedding-001
(lo dice la propia documentación del modelo); usar otra métrica
(euclidiana, producto punto) daría resultados de similitud sin sentido,
aunque el código "funcione" sin error.

Uso:
    python init_qdrant.py
"""
import logging
import os

from dotenv import load_dotenv
from qdrant_client import QdrantClient

load_dotenv()
from qdrant_client.http.models import Distance, VectorParams

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

COLLECTION_NAME = "events"
VECTOR_SIZE = 768  # gemini-embedding-001 con output_dimensionality=768


def init_collection() -> None:
    url = os.environ.get("QDRANT_URL")
    api_key = os.environ.get("QDRANT_API_KEY")  # None está bien para una instancia local sin auth

    if not url:
        raise RuntimeError(
            "QDRANT_URL no está seteada -- revisá tu .env antes de correr esto. "
            "No hay un default silencioso a localhost: mejor fallar explícito "
            "que terminar escribiendo sin querer contra la instancia equivocada."
        )

    log.info("Conectando a Qdrant en %s…", url)
    client = QdrantClient(url=url, api_key=api_key)

    if client.collection_exists(COLLECTION_NAME):
        log.info(
            "La colección '%s' ya existe -- no se toca. "
            "Si necesitás recrearla desde cero, borrala a mano primero "
            "(client.delete_collection) y corré este script de nuevo.",
            COLLECTION_NAME,
        )
        return

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    log.info(
        "✅ Colección '%s' creada -- vectores de %d dimensiones, distancia coseno.",
        COLLECTION_NAME, VECTOR_SIZE,
    )


if __name__ == "__main__":
    init_collection()