# scraper/load_cities.py
"""Carga las ciudades argentinas de Jodify a la tabla cities."""

import logging
import uuid
from datetime import datetime

import ftfy
from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import City

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

CITIES = [
    {"id": "3fd2f7c9-97e4-4f26-af32-6b36d82e8963", "name": "Bahía Blanca", "alias": "BahiaBlanca", "latitude": -38.7196, "longitude": -62.2679, "popular": False},
    {"id": "258fd495-92d3-4119-aa37-0d1c684a0237", "name": "CABA | GBA", "alias": "CABA_GBA", "latitude": -34.6132, "longitude": -58.3772, "popular": True},
    {"id": "8d62810d-cbb4-4c6a-b476-1c23f77b3992", "name": "Catamarca", "alias": "Catamarca", "latitude": -28.4696, "longitude": -65.7852, "popular": False},
    {"id": "9a4e8910-8fe7-4fc5-b07d-855e6b36f6a2", "name": "Chaco", "alias": "Chaco", "latitude": -27.4514, "longitude": -58.9867, "popular": False},
    {"id": "8fe5dc25-bdbe-4958-a8b3-422ff70c9b7f", "name": "Chubut", "alias": "Chubut", "latitude": -43.3002, "longitude": -65.1023, "popular": False},
    {"id": "90a19b2e-5502-4ab5-9a77-8e035ac9f5e0", "name": "Corrientes", "alias": "Corrientes", "latitude": -27.4712, "longitude": -58.8396, "popular": False},
    {"id": "0687cb63-bcdd-475b-af26-c6e33a845705", "name": "Córdoba", "alias": "Cordoba", "latitude": -31.4201, "longitude": -64.1888, "popular": True},
    {"id": "7bf5c225-aeff-4b73-b107-6b5c03c0f017", "name": "Entre Ríos", "alias": "EntreRios", "latitude": -31.7319, "longitude": -60.5238, "popular": False},
    {"id": "18f1dc19-f3b4-4b9e-99c0-dcb505e58441", "name": "Formosa", "alias": "Formosa", "latitude": -26.1849, "longitude": -58.1731, "popular": False},
    {"id": "b5c1d49e-7ba6-4d2a-a242-71c38c7f9eb4", "name": "Jujuy", "alias": "Jujuy", "latitude": -24.1858, "longitude": -65.2995, "popular": False},
    {"id": "4c8c6e17-6c44-42ad-85eb-d1d7b3b4b27f", "name": "Junín", "alias": "Junin", "latitude": -34.5843, "longitude": -60.9493, "popular": False},
    {"id": "a4259d48-3b7a-45e6-b4b5-efb91dc6e0a4", "name": "La Pampa", "alias": "LaPampa", "latitude": -36.6167, "longitude": -64.2833, "popular": False},
    {"id": "c80ef4d8-5d6e-4d1e-97a0-779b6d8d28a1", "name": "La Plata", "alias": "LaPlata", "latitude": -34.9215, "longitude": -57.9545, "popular": True},
    {"id": "4f1ec63a-ec28-4486-aa47-c5242fe0ff6f", "name": "La Rioja", "alias": "LaRioja", "latitude": -29.4111, "longitude": -66.8507, "popular": False},
    {"id": "0042147e-6046-463f-a4c6-c8fa5d0b8404", "name": "Mar Del Plata", "alias": "MarDelPlata", "latitude": -38.0023, "longitude": -57.5575, "popular": True},
    {"id": "689e0c51-2f1c-443a-aa0a-49b9509f0ea5", "name": "Mendoza", "alias": "Mendoza", "latitude": -32.8895, "longitude": -68.8458, "popular": False},
    {"id": "0fb6a959-6fd7-4c3c-b0a4-ecd93c751224", "name": "Misiones", "alias": "Misiones", "latitude": -27.3623, "longitude": -55.9003, "popular": False},
    {"id": "aa5643fa-1ff3-4a88-bfad-bcd726fb010b", "name": "Neuquén", "alias": "Neuquen", "latitude": -38.9516, "longitude": -68.0591, "popular": False},
    {"id": "67e55044-10b1-426f-9247-bb680e5fe0c8", "name": "Pinamar | Villa Gesell", "alias": "Pinamar", "latitude": -37.1164, "longitude": -56.8545, "popular": False},
    {"id": "a9b64cb9-2f62-45d4-8ee2-3fb88f3d64f5", "name": "Prov. de Buenos Aires", "alias": "InteriorBA", "latitude": -37.3217, "longitude": -59.1332, "popular": False},
    {"id": "cfd3c5e7-20b1-483e-8d2a-2da12b81a1b9", "name": "Rosario", "alias": "Rosario", "latitude": -32.9442, "longitude": -60.6505, "popular": True},
    {"id": "6268af73-1aea-4ad3-9e95-22d37e7f6458", "name": "Río Negro", "alias": "RioNegro", "latitude": -40.8135, "longitude": -62.9967, "popular": False},
    {"id": "8e6de5b7-47c3-4712-baf1-4562e0b2d0c1", "name": "Salta", "alias": "Salta", "latitude": -24.7821, "longitude": -65.4232, "popular": False},
    {"id": "f95ecb5e-ae7a-4d54-9d89-fca48b68ab24", "name": "San Juan", "alias": "SanJuan", "latitude": -31.5375, "longitude": -68.5364, "popular": False},
    {"id": "1d6b0108-8a6a-4f88-9946-3e1af02472e5", "name": "San Luis", "alias": "SanLuis", "latitude": -33.3016, "longitude": -66.3378, "popular": False},
    {"id": "ab5d9dab-11f2-4b35-a2d5-241e49883128", "name": "Santa Cruz", "alias": "SantaCruz", "latitude": -49.2333, "longitude": -67.5833, "popular": False},
    {"id": "aaece971-8e1c-48eb-bc32-786a173e0c3d", "name": "Santa Fe | Paraná", "alias": "SantaFe_Parana", "latitude": -31.6258, "longitude": -60.702, "popular": False},
    {"id": "dcb9d2b2-99ee-40c0-b0b7-0d45b9e2537c", "name": "Santiago Del Estero", "alias": "SantiagoDelEstero", "latitude": -27.7951, "longitude": -64.2615, "popular": False},
    {"id": "1d1b66da-b3dd-498e-bd78-7cf51c140d2e", "name": "Tandil", "alias": "Tandil", "latitude": -37.3182, "longitude": -59.1343, "popular": False},
    {"id": "6e5df917-6128-4c4e-a20e-90c81c15d075", "name": "Tierra Del Fuego", "alias": "TierraDelFuego", "latitude": -54.8019, "longitude": -68.3029, "popular": False},
    {"id": "4a0a685b-2343-4d82-a4d3-efc5b0220b8e", "name": "Tucumán", "alias": "Tucuman", "latitude": -26.8083, "longitude": -65.2176, "popular": False},
]


def load_cities() -> None:
    db: Session = SessionLocal()
    try:
        inserted = 0
        skipped = 0
        for c in CITIES:
            existing = db.query(City).filter_by(id=uuid.UUID(c["id"])).first()
            if existing:
                skipped += 1
                continue
            city = City(
                id=uuid.UUID(c["id"]),
                name=c["name"],
                alias=c["alias"],
                country="Argentina",
                latitude=c["latitude"],
                longitude=c["longitude"],
                popular=c["popular"],
            )
            db.add(city)
            inserted += 1

        db.commit()
        log.info("✅ Ciudades cargadas — insertadas: %d | ya existían: %d", inserted, skipped)
    except Exception as e:
        db.rollback()
        log.error("Error: %s", e)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    load_cities()