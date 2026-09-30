"""
Endpoints del panel de administracion. Todos, sin excepcion, dependen de
get_current_admin_user (definida en auth/dependencies.py) -- la proteccion
real vive aca, en el backend; que el frontend oculte o no un link en el
menu es solo comodidad visual, nunca la barrera de seguridad en si.

Este archivo arranca con un unico endpoint real (estadisticas del
dashboard) que sirve de plantilla ya validada para el resto del CRUD:
mismo patron de import, misma forma de aplicar la dependencia, mismo
manejo de sesion de base de datos. Los endpoints de crear/editar/borrar
eventos, y el de listar para la tabla del panel, se agregan en este mismo
archivo siguiendo ese patron.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth.dependencies import get_current_admin_user
from database.connection import SessionLocal
from database.models import Event, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/stats")
def get_admin_stats(admin: User = Depends(get_current_admin_user)):
    """
    Metricas reales del proyecto, no solo conteos genericos -- las mismas
    que ya vienen apareciendo en el informe (cobertura de precio,
    precision de venues), ahora visibles sin tener que correr una
    consulta a mano cada vez.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        total = db.query(func.count(Event.id)).filter(Event.is_active == True).scalar()
        activos = (
            db.query(func.count(Event.id))
            .filter(Event.is_active == True, Event.date_from >= now)
            .scalar()
        )
        pasados = total - activos

        con_precio = (
            db.query(func.count(Event.id))
            .filter(Event.is_active == True, Event.min_price.isnot(None))
            .scalar()
        )

        return {
            "eventos_activos": activos,
            "eventos_pasados": pasados,
            "eventos_totales": total,
            "cobertura_precio": {
                "con_precio": con_precio,
                "porcentaje": round(con_precio / total * 100, 1) if total else 0,
            },
        }
    finally:
        db.close()


# A continuacion, siguiendo el mismo patron de arriba (import, Depends de
# get_current_admin_user, sesion propia con try/finally):
#
#   GET    /api/admin/events            -> listar TODOS los eventos (activos
#                                          e inactivos), paginado, para la
#                                          tabla del panel
#   PUT    /api/admin/events/{event_id} -> editar campos de un evento
#   DELETE /api/admin/events/{event_id} -> soft delete (is_active = False),
#                                          nunca un DELETE real de la fila
#   PUT    /api/admin/venues/{venue_id}/coordinates
#                                        -> mover un venue completo a nuevas
#                                          coordenadas (ver nota en el
#                                          prompt sobre por que es el venue
#                                          y no el evento individual)