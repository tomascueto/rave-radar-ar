"""
Jodify scraper — extrae eventos de jodify.com.ar via Next.js Server Action.

El endpoint utiliza un POST paginado a /events?citiesId=... con un header
`next-action` que identifica la Server Action. La respuesta es formato RSC
(React Server Components), donde la línea `1:[...]` contiene el array de
eventos agrupados por fecha.

Particularidad: algunas páginas incluyen texto libre antes del JSON (ej.
descripciones de eventos con el formato `2:Tlen,texto...1:[...]`). El parser
maneja esto buscando el patrón `1:[` en cualquier posición del texto.

Uso:
    python -m scraper.sources.jodify
    python -m scraper.sources.jodify --output data/eventos.json
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE_URL = "https://jodify.com.ar/events"

# IDs de las 29 ciudades cubiertas por Jodify (Argentina)
CITIES_IDS: list[str] = [
    "3fd2f7c9-97e4-4f26-af32-6b36d82e8963",
    "258fd495-92d3-4119-aa37-0d1c684a0237",
    "8d62810d-cbb4-4c6a-b476-1c23f77b3992",
    "9a4e8910-8fe7-4fc5-b07d-855e6b36f6a2",
    "8fe5dc25-bdbe-4958-a8b3-422ff70c9b7f",
    "90a19b2e-5502-4ab5-9a77-8e035ac9f5e0",
    "0687cb63-bcdd-475b-af26-c6e33a845705",
    "7bf5c225-aeff-4b73-b107-6b5c03c0f017",
    "18f1dc19-f3b4-4b9e-99c0-dcb505e58441",
    "b5c1d49e-7ba6-4d2a-a242-71c38c7f9eb4",
    "4c8c6e17-6c44-42ad-85eb-d1d7b3b4b27f",
    "a4259d48-3b7a-45e6-b4b5-efb91dc6e0a4",
    "c80ef4d8-5d6e-4d1e-97a0-779b6d8d28a1",
    "4f1ec63a-ec28-4486-aa47-c5242fe0ff6f",
    "0042147e-6046-463f-a4c6-c8fa5d0b8404",
    "689e0c51-2f1c-443a-aa0a-49b9509f0ea5",
    "0fb6a959-6fd7-4c3c-b0a4-ecd93c751224",
    "aa5643fa-1ff3-4a88-bfad-bcd726fb010b",
    "a9b64cb9-2f62-45d4-8ee2-3fb88f3d64f5",
    "6268af73-1aea-4ad3-9e95-22d37e7f6458",
    "8e6de5b7-47c3-4712-baf1-4562e0b2d0c1",
    "f95ecb5e-ae7a-4d54-9d89-fca48b68ab24",
    "1d6b0108-8a6a-4f88-9946-3e1af02472e5",
    "ab5d9dab-11f2-4b35-a2d5-241e49883128",
    "aaece971-8e1c-48eb-bc32-786a173e0c3d",
    "dcb9d2b2-99ee-40c0-b0b7-0d45b9e2537c",
    "1d1b66da-b3dd-498e-bd78-7cf51c140d2e",
    "6e5df917-6128-4c4e-a20e-90c81c15d075",
    "4a0a685b-2343-4d82-a4d3-efc5b0220b8e",
]

CITIES_PARAM = ",".join(CITIES_IDS)
CITIES_ENCODED = CITIES_PARAM.replace(",", "%2C")

# Token del Server Action de Next.js — puede cambiar si Jodify redeploya.
# Si el scraper deja de funcionar, revisar este valor en las DevTools del browser.
NEXT_ACTION_TOKEN = "7fb08ab6c709e78b085aa025f4739302081cbf340c"

REQUEST_HEADERS: dict[str, str] = {
    "accept": "text/x-component",
    "content-type": "text/plain;charset=UTF-8",
    "next-action": NEXT_ACTION_TOKEN,
    "next-router-state-tree": (
        "%5B%22%22%2C%7B%22children%22%3A%5B%22(10-PublicApp-WebUser)%22%2C%7B%22children"
        "%22%3A%5B%22(00PublicRoutes)%22%2C%7B%22children%22%3A%5B%22events%22%2C%7B%22"
        "children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D"
        "%2C%22event%22%3A%5B%22__DEFAULT__%22%2C%7B%7D%2Cnull%2Cnull%5D%2C%22login%22"
        "%3A%5B%22__DEFAULT__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull"
        "%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D"
    ),
    "origin": "https://jodify.com.ar",
    "referer": f"{BASE_URL}?citiesId={CITIES_ENCODED}",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}

# Parámetros de paginación y red
MAX_PAGES = 100          # techo de seguridad
REQUEST_TIMEOUT = 20     # segundos
RETRY_TOTAL = 3
RETRY_BACKOFF = 1.0      # segundos base para backoff exponencial
DELAY_BETWEEN_PAGES = 0.3  # segundos entre páginas (cortesía)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Parsing del formato RSC
# ---------------------------------------------------------------------------

def parse_events_from_rsc(text: str) -> list[dict[str, Any]]:
    """
    Extrae eventos del response RSC de Jodify.

    El formato es una secuencia de líneas `N:payload`. La que contiene los
    eventos sigue el patrón `1:[{fecha: [eventos...]}, ...]` y puede aparecer
    en medio de una línea con texto libre (descripciones de eventos).

    Ejemplo de línea "simple":
        1:[{"2026-06-05T03:00:00.000Z": [{...evento...}]}]

    Ejemplo con texto libre antes (páginas con descripción larga):
        2:T471,texto largo del evento...1:[{"2026-06-14T03:00:00.000Z": [...]}]

    Returns:
        Lista de dicts de eventos. Vacía si no se encontró nada parseable.
    """
    match = re.search(r'1:(\[.*)', text, re.DOTALL)
    if not match:
        return []

    json_str = match.group(1).strip()

    # Intento 1: parseo directo
    try:
        data = json.loads(json_str)
        return _extract_events_from_rsc_data(data)
    except json.JSONDecodeError as exc:
        pass

    # Intento 2: truncar en la primera posición inválida y buscar
    # el último `]` válido hacia atrás
    truncated = json_str[:exc.pos] if exc.pos > 0 else json_str
    for i in range(len(truncated) - 1, -1, -1):
        if truncated[i] == ']':
            try:
                data = json.loads(truncated[: i + 1])
                logger.debug("JSON truncado en pos %d (original %d chars)", i + 1, len(json_str))
                return _extract_events_from_rsc_data(data)
            except json.JSONDecodeError:
                continue

    logger.warning("No se pudo parsear el JSON de la página.")
    return []


def _extract_events_from_rsc_data(data: Any) -> list[dict[str, Any]]:
    """
    Navega la estructura `[{fecha: [evento, ...]}]` y devuelve eventos planos.

    data puede ser:
    - lista de dicts {fecha_iso: [eventos]}
    - dict directo {fecha_iso: [eventos]}  (raro, por si acaso)
    """
    events: list[dict[str, Any]] = []

    items = data if isinstance(data, list) else [data]
    for item in items:
        if not isinstance(item, dict):
            continue
        for _date_key, event_list in item.items():
            if not isinstance(event_list, list):
                continue
            for ev in event_list:
                if isinstance(ev, dict) and "id" in ev and "date_from" in ev:
                    events.append(ev)

    return events


# ---------------------------------------------------------------------------
# HTTP session con retry
# ---------------------------------------------------------------------------

def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=RETRY_TOTAL,
        backoff_factor=RETRY_BACKOFF,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# ---------------------------------------------------------------------------
# Scraper principal
# ---------------------------------------------------------------------------

def fetch_all_events() -> list[dict[str, Any]]:
    """
    Itera las páginas del Server Action de Jodify y devuelve todos los eventos.

    Detiene la paginación cuando:
    - La página no devuelve eventos nuevos (duplicados o vacío).
    - El status HTTP no es 200.
    - Se alcanza MAX_PAGES.

    Returns:
        Lista de eventos únicos (deduplicados por `id`).
    """
    url = f"{BASE_URL}?citiesId={CITIES_ENCODED}"
    session = _build_session()

    all_events: dict[str, dict[str, Any]] = {}  # id → evento
    page = 1

    logger.info("Iniciando scraping de Jodify (%d ciudades)…", len(CITIES_IDS))

    while page <= MAX_PAGES:
        body = json.dumps([{"citiesId": CITIES_PARAM, "page": str(page)}])

        try:
            response = session.post(
                url,
                headers=REQUEST_HEADERS,
                data=body,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as exc:
            logger.error("Error de red en página %d: %s", page, exc)
            break

        if response.status_code != 200:
            logger.error(
                "Página %d: HTTP %d — abortando.", page, response.status_code
            )
            break

        page_events = parse_events_from_rsc(response.text)

        if not page_events:
            logger.info("Página %d: sin eventos → fin de paginación.", page)
            break

        new_count = 0
        for ev in page_events:
            eid = ev.get("id")
            if eid and eid not in all_events:
                all_events[eid] = ev
                new_count += 1

        logger.info(
            "Página %d: %d nuevos | acumulado: %d",
            page,
            new_count,
            len(all_events),
        )

        if new_count == 0:
            logger.info("Sin eventos nuevos → fin de paginación.")
            break

        page += 1
        time.sleep(DELAY_BETWEEN_PAGES)

    events_list = list(all_events.values())
    logger.info("✅ Scraping finalizado. Total: %d eventos únicos.", len(events_list))
    return events_list


# ---------------------------------------------------------------------------
# Guardado de resultados
# ---------------------------------------------------------------------------

def save_results(
    events: list[dict[str, Any]],
    output_path: str | Path = "events_raw.json",
    ids_path: str | Path = "event_ids.json",
) -> None:
    """Guarda eventos completos e IDs en archivos JSON."""
    output_path = Path(output_path)
    ids_path = Path(ids_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    logger.info("Eventos guardados en: %s", output_path)

    ids = [ev["id"] for ev in events]
    with open(ids_path, "w", encoding="utf-8") as f:
        json.dump(ids, f, indent=2)
    logger.info("IDs guardados en: %s", ids_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scraper de eventos de Jodify.com.ar"
    )
    parser.add_argument(
        "--output",
        default="events_raw.json",
        help="Ruta del archivo JSON con eventos completos (default: events_raw.json)",
    )
    parser.add_argument(
        "--ids",
        default="event_ids.json",
        help="Ruta del archivo JSON con solo los IDs (default: event_ids.json)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Nivel de logging (default: INFO)",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    events = fetch_all_events()
    save_results(events, output_path=args.output, ids_path=args.ids)


if __name__ == "__main__":
    main()