# weather_utils.py
"""
Clima para eventos guardados, vía Open-Meteo (sin API key, gratis para uso
no comercial, modelos globales -- no depende de estaciones físicas locales,
así que cubre Argentina igual de bien que cualquier otro país).

Se pide por HORA, no por día: un evento nocturno (la gran mayoría acá) no
se representa bien con el máximo/mínimo diario, que corresponde a otro
momento del día. Se busca la hora del pronóstico más cercana al horario
real del evento.

Límite real: Open-Meteo da pronóstico hasta 16 días hacia adelante. Un
evento guardado para más adelante que eso simplemente no tiene pronóstico
todavía -- get_event_weather devuelve None en ese caso, nunca un dato
inventado.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

import requests

log = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 16  # maximo que ofrece Open-Meteo
CACHE_TTL_SECONDS = 3 * 60 * 60  # 3 horas -- el pronostico no cambia sustancialmente en ese lapso

# Códigos WMO (estándar meteorológico internacional, los mismos que usa
# Open-Meteo) agrupados a una condición en español -- la API los devuelve
# como número, no como texto.
WMO_CONDITIONS: dict[int, str] = {
    0: "Despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla con escarcha",
    51: "Llovizna débil",
    53: "Llovizna moderada",
    55: "Llovizna intensa",
    56: "Llovizna helada débil",
    57: "Llovizna helada intensa",
    61: "Lluvia débil",
    63: "Lluvia moderada",
    65: "Lluvia intensa",
    66: "Lluvia helada débil",
    67: "Lluvia helada intensa",
    71: "Nevada débil",
    73: "Nevada moderada",
    75: "Nevada intensa",
    77: "Granizo pequeño",
    80: "Chubascos débiles",
    81: "Chubascos moderados",
    82: "Chubascos violentos",
    85: "Chubascos de nieve débiles",
    86: "Chubascos de nieve intensos",
    95: "Tormenta eléctrica",
    96: "Tormenta con granizo débil",
    99: "Tormenta con granizo intenso",
}


def weather_code_to_condition(code: int) -> str:
    return WMO_CONDITIONS.get(code, "Condición desconocida")


# Orden de severidad para elegir, dentro de una ventana de varias horas, la
# condición que más vale la pena mostrar -- no la más frecuente (un
# promedio puede esconder una tormenta puntual entre horas despejadas),
# la PEOR. Códigos no listados (ninguno debería faltar) caen al final.
_SEVERITY_TIERS: list[set[int]] = [
    {0, 1},               # despejado / mayormente despejado
    {2, 3},                # parcialmente nublado / nublado
    {45, 48},              # niebla
    {51, 53, 55, 56, 57},  # llovizna
    {61, 63, 65, 66, 67, 80, 81, 82},  # lluvia / chubascos
    {71, 73, 75, 77, 85, 86},          # nieve / granizo
    {95, 96, 99},          # tormenta electrica
]


def _severity(code: int) -> int:
    for tier, codes in enumerate(_SEVERITY_TIERS):
        if code in codes:
            return tier
    return len(_SEVERITY_TIERS)  # codigo no mapeado -- al final, no al frente


# Caché en memoria: {(lat redondeada, lng redondeada, hora ISO): (valor, expira_en)}
# Se pierde al reiniciar el backend -- aceptable, no es un dato que necesite
# sobrevivir un restart, se vuelve a pedir solo y es gratis.
_cache: dict[tuple, tuple[dict, float]] = {}


def _fetch_hourly_block(lat: float, lng: float) -> dict | None:
    """
    Trae (o reusa de caché) el pronóstico por hora completo para esta
    ubicación, cubriendo los próximos FORECAST_DAYS días -- una sola
    respuesta de Open-Meteo ya trae 16 días de datos. Se cachea el
    bloque ENTERO por ubicación, no por hora puntual: varios eventos en
    el mismo venue (horarios distintos) reusan la misma respuesta, igual
    que el mismo usuario recargando la pantalla poco después.
    """
    cache_key = (round(lat, 2), round(lng, 2))
    cached = _cache.get(cache_key)
    if cached and cached[1] > time.time():
        return cached[0]

    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": "temperature_2m,apparent_temperature,weather_code",
        "forecast_days": FORECAST_DAYS,
        "timezone": "auto",
    }
    try:
        r = requests.get(FORECAST_URL, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
    except requests.RequestException as e:
        log.warning("Error consultando Open-Meteo (%s, %s): %s", lat, lng, e)
        return None

    hourly = data.get("hourly", {})
    if not hourly.get("time"):
        return None

    _cache[cache_key] = (hourly, time.time() + CACHE_TTL_SECONDS)
    return hourly


DEFAULT_EVENT_DURATION_HOURS = 10  # fallback cuando no hay date_to -- coherente con eventos tipicos de 22 a 08


def get_event_weather(
    lat: float, lng: float, date_from: datetime, date_to: datetime | None = None,
) -> dict | None:
    """
    Devuelve el clima para toda la ventana del evento (no un solo punto):
    {
      "summary": {"temp_min", "temp_max", "feels_min", "feels_max", "condition", "condition_code"},
      "hourly": [{"time", "temperature", "feels_like", "condition", "condition_code"}, ...],
    }
    condition_code es el codigo WMO crudo -- el frontend lo usa para elegir
    un emoji, "condition" (texto en español) queda para accesibilidad
    (aria-label/title).
    o None si el evento está fuera de la ventana de 16 días de Open-Meteo
    (nunca se inventa un dato).

    Si date_to no viene, se asume date_from + DEFAULT_EVENT_DURATION_HOURS --
    la gran mayoría de los eventos de esta app son nocturnos, de un rango
    bastante parecido a eso.

    "condition" del resumen no es la más frecuente en la ventana -- es la
    PEOR (ver _SEVERITY_TIERS). Una tormenta a las 3am importa más que ocho
    horas despejadas antes, para alguien decidiendo qué llevar.
    """
    if date_from.tzinfo is None:
        date_from = date_from.replace(tzinfo=timezone.utc)
    window_end = date_to or (date_from + timedelta(hours=DEFAULT_EVENT_DURATION_HOURS))
    if window_end.tzinfo is None:
        window_end = window_end.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    days_ahead = (date_from.date() - now.date()).days
    if days_ahead < 0 or days_ahead > FORECAST_DAYS:
        return None

    hourly = _fetch_hourly_block(lat, lng)
    if not hourly:
        return None

    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    feels = hourly.get("apparent_temperature", [])
    codes = hourly.get("weather_code", [])
    if not times:
        return None

    start_ts = date_from.timestamp()
    end_ts = window_end.timestamp()

    in_window = [
        i for i in range(len(times))
        if start_ts <= datetime.fromisoformat(times[i]).replace(tzinfo=date_from.tzinfo).timestamp() <= end_ts
    ]
    if not in_window:
        # La ventana cae fuera de lo que Open-Meteo devolvió (ej: evento
        # justo en el limite de los 16 dias) -- usar la hora mas cercana
        # a date_from como mejor aproximacion, en vez de no mostrar nada.
        target_ts = start_ts
        in_window = [min(
            range(len(times)),
            key=lambda i: abs(datetime.fromisoformat(times[i]).replace(tzinfo=date_from.tzinfo).timestamp() - target_ts),
        )]

    worst_idx = max(in_window, key=lambda i: _severity(codes[i]))

    hourly_detail = [
        {
            "time": times[i],
            "temperature": temps[i],
            "feels_like": feels[i],
            "condition": weather_code_to_condition(codes[i]),
            "condition_code": codes[i],
        }
        for i in in_window
    ]

    return {
        "summary": {
            "temp_min": min(temps[i] for i in in_window),
            "temp_max": max(temps[i] for i in in_window),
            "feels_min": min(feels[i] for i in in_window),
            "feels_max": max(feels[i] for i in in_window),
            "condition": weather_code_to_condition(codes[worst_idx]),
            "condition_code": codes[worst_idx],
        },
        "hourly": hourly_detail,
    }