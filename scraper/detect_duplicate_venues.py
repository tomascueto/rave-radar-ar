"""
Detecta venues potencialmente duplicados (solo lectura, no modifica nada).

Estrategia:
  1. Agrupa venues por city_id (nunca compara entre ciudades distintas,
     porque el mismo nombre en dos ciudades son lugares diferentes —
     ej. "Palacio Alsina" existe en Buenos Aires y en Córdoba).
  2. Dentro de cada ciudad, compara nombres de a pares con
     difflib.SequenceMatcher (similitud de texto, 0.0 a 1.0).
  3. Si además ambos venues tienen coordenadas, calcula la distancia entre
     ellos — dos nombres parecidos Y coordenadas muy cercanas es una señal
     mucho más fuerte de duplicado real que solo el nombre.
  4. Imprime un reporte para revisión manual. No fusiona ni borra nada.

Uso:
    python -m scraper.detect_duplicate_venues
    python -m scraper.detect_duplicate_venues --threshold 0.75
"""

import argparse
import math
from collections import defaultdict
from difflib import SequenceMatcher

from sqlalchemy.orm import Session
from geoalchemy2.shape import to_shape

from database.connection import SessionLocal
from database.models import City, Venue, Event


DEFAULT_THRESHOLD = 0.80   # similitud mínima de nombre para considerar sospechoso
CLOSE_DISTANCE_KM = 1.0    # si además están a menos de esto, la sospecha es mucho más fuerte


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def get_coords(venue: Venue) -> tuple[float, float] | None:
    if venue.coordinates is None:
        return None
    point = to_shape(venue.coordinates)
    return point.y, point.x  # (lat, lng)


def detect(threshold: float = DEFAULT_THRESHOLD) -> None:
    db: Session = SessionLocal()
    try:
        cities = {c.id: c.name for c in db.query(City).all()}
        venues = db.query(Venue).all()

        # Contamos cuántos eventos tiene cada venue (para saber cuál es el "principal")
        event_counts: dict = defaultdict(int)
        for (venue_id, count) in (
            db.query(Event.venue_id, Event.id).all()
        ):
            event_counts[venue_id] += 1

        by_city: dict = defaultdict(list)
        for v in venues:
            by_city[v.city_id].append(v)

        total_sospechosos = 0
        total_confirmados_por_distancia = 0

        print(f"\n{'='*80}")
        print(f"DETECCIÓN DE VENUES DUPLICADOS (umbral de similitud: {threshold})")
        print(f"{'='*80}\n")

        for city_id, venues_in_city in by_city.items():
            city_name = cities.get(city_id, "Sin ciudad") if city_id else "Sin ciudad"

            if len(venues_in_city) < 2:
                continue

            for i in range(len(venues_in_city)):
                for j in range(i + 1, len(venues_in_city)):
                    v1, v2 = venues_in_city[i], venues_in_city[j]
                    sim = name_similarity(v1.name, v2.name)

                    if sim < threshold:
                        continue

                    total_sospechosos += 1

                    coords1 = get_coords(v1)
                    coords2 = get_coords(v2)
                    dist_str = "sin coordenadas para comparar"
                    confirmado = False

                    if coords1 and coords2:
                        dist = haversine_km(*coords1, *coords2)
                        dist_str = f"{dist:.2f} km"
                        if dist <= CLOSE_DISTANCE_KM:
                            confirmado = True
                            total_confirmados_por_distancia += 1

                    marca = "🔴 ALTA CONFIANZA" if confirmado else "🟡 revisar"

                    print(f"{marca} | ciudad: {city_name} | similitud: {sim:.2f} | distancia: {dist_str}")
                    print(f"   [1] '{v1.name}' (barrio: {v1.neighborhood}) — {event_counts.get(v1.id, 0)} eventos — id={v1.id}")
                    print(f"   [2] '{v2.name}' (barrio: {v2.neighborhood}) — {event_counts.get(v2.id, 0)} eventos — id={v2.id}")
                    print()

        print(f"{'='*80}")
        print(f"Total pares sospechosos (por nombre): {total_sospechosos}")
        print(f"De esos, confirmados por proximidad (<{CLOSE_DISTANCE_KM} km): {total_confirmados_por_distancia}")
        print(f"{'='*80}\n")
        print("Este script NO modifica nada — es solo para revisión.")

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detecta venues potencialmente duplicados")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                         help=f"Umbral de similitud de nombre (0.0-1.0, default {DEFAULT_THRESHOLD})")
    args = parser.parse_args()
    detect(threshold=args.threshold)