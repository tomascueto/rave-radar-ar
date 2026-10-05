import os
from dotenv import load_dotenv
import psycopg2
from qdrant_client import QdrantClient

# Cargamos las variables del .env
load_dotenv()

def test_supabase():
    print("⏳ Probando conexión a Supabase (PostgreSQL + PostGIS)...")
    try:
        # Nos conectamos usando la DATABASE_URL
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        cursor = conn.cursor()
        
        # Le pedimos que nos diga la versión de PostGIS instalada
        cursor.execute("SELECT PostGIS_version();")
        version = cursor.fetchone()
        
        print(f"✅ ¡Supabase OK! Versión de PostGIS detectada: {version[0]}")
        
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"❌ Error en Supabase: {e}")

def test_qdrant():
    print("\n⏳ Probando conexión a Qdrant Cloud...")
    try:
        # Nos conectamos con la URL y la API Key
        client = QdrantClient(
            url=os.getenv("QDRANT_URL"),
            api_key=os.getenv("QDRANT_API_KEY")
        )
        
        # Pedimos la lista de colecciones (debería venir vacía porque es nuevo)
        collections = client.get_collections()
        
        print(f"✅ ¡Qdrant Cloud OK! Conexión exitosa. Colecciones actuales: {collections.collections}")
    except Exception as e:
        print(f"❌ Error en Qdrant: {e}")

if __name__ == "__main__":
    print("🚀 INICIANDO TEST DE INFRAESTRUCTURA - RAVE RADAR AR\n" + "-"*50)
    test_supabase()
    test_qdrant()
    print("-" * 50)