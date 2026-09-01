"""
Reintento con backoff exponencial, exclusivo para errores transitorios del
servidor de Gemini (503 UNAVAILABLE — sobrecarga momentánea de Google, no
un límite propio). Los errores de cuota (429) se propagan de inmediato sin
reintentar, porque esperar no cambia nada: la cuota diaria no se libera en
unos segundos.
"""

import logging
import time

from google.genai import errors as genai_errors

log = logging.getLogger(__name__)


def call_with_retry(fn, *args, max_retries: int = 3, base_delay: float = 2.0, **kwargs):
    """
    Ejecuta fn(*args, **kwargs). Si falla con ServerError (5xx, ej. 503),
    reintenta con backoff exponencial (2s, 4s, 8s...). Cualquier otro tipo
    de error (incluido 429 por cuota) se propaga inmediatamente.
    """
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return fn(*args, **kwargs)
        except genai_errors.ServerError as exc:
            last_exc = exc
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                log.warning(
                    "Error transitorio del servidor (intento %d/%d), "
                    "reintentando en %.0fs: %s",
                    attempt + 1, max_retries, delay, exc,
                )
                time.sleep(delay)
            else:
                log.error("Se agotaron los reintentos (%d).", max_retries)
    raise last_exc