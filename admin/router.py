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

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.functions import ST_GeomFromText
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from auth.dependencies import get_current_admin_user
from database.connection import SessionLocal
from database.models import Event, EventGenre, User, Venue

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _venue_coords(venue: Venue) -> tuple[float | None, float | None]:
    """Mismo criterio que _extract_coords en api_events.py -- PostGIS
    Geometry -> (lat, lng), None si el venue no tiene coordenadas."""
    if venue is None or venue.coordinates is None:
        return None, None
    point = to_shape(venue.coordinates)
    return point.y, point.x


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

        # Distribucion real de precision de geocodificacion (exact/city/
        # llm_search/manual/unknown) sobre los eventos ACTIVOS -- no sobre
        # venues, para que el numero responda "cuanto de lo que hoy se ve
        # en el mapa esta bien ubicado", no "cuantos venues distintos hay
        # de cada precision" (un venue con 20 eventos activos pesa 20 veces
        # mas en esta cuenta, a proposito).
        precision_rows = (
            db.query(Venue.precision, func.count(Event.id))
            .join(Event, Event.venue_id == Venue.id)
            .filter(Event.is_active == True)
            .group_by(Venue.precision)
            .all()
        )
        venue_precision = {(precision or "unknown"): count for precision, count in precision_rows}

        return {
            "eventos_activos": activos,
            "eventos_pasados": pasados,
            "eventos_totales": total,
            "cobertura_precio": {
                "con_precio": con_precio,
                "porcentaje": round(con_precio / total * 100, 1) if total else 0,
            },
            "venue_precision": venue_precision,
        }
    finally:
        db.close()


class EventAdminOut(BaseModel):
    id: str
    name: str
    date_from: str
    date_to: str | None
    min_price: float | None
    max_price: float | None
    currency: str | None
    ticket_url: str | None
    flyer_url: str | None
    is_active: bool
    venue_id: str
    venue_name: str | None
    genres: list[str]


class EventsPageOut(BaseModel):
    items: list[EventAdminOut]
    total: int
    page: int
    page_size: int


class EventUpdateIn(BaseModel):
    """Todos los campos opcionales -- PUT parcial: solo se tocan los que
    el request realmente incluyo (ver exclude_unset abajo), asi que el
    frontend puede mandar unicamente lo que cambio sin arrastrar el resto
    del evento. venue_id aca es la reasignacion "este evento cambio de
    lugar" (Parte 4b) -- nunca toca coordenadas de ningun venue."""
    name: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    min_price: float | None = None
    max_price: float | None = None
    ticket_url: str | None = None
    flyer_url: str | None = None
    venue_id: str | None = None


class VenueOut(BaseModel):
    id: str
    name: str
    address: str | None
    neighborhood: str | None
    city_name: str | None
    precision: str | None
    lat: float | None
    lng: float | None
    event_count: int


class VenueCreateIn(BaseModel):
    name: str
    lat: float
    lng: float


class VenueCoordinatesIn(BaseModel):
    lat: float
    lng: float


def _event_to_admin_out(ev: Event) -> EventAdminOut:
    return EventAdminOut(
        id=str(ev.id),
        name=ev.name,
        date_from=ev.date_from.isoformat() if ev.date_from else "",
        date_to=ev.date_to.isoformat() if ev.date_to else None,
        min_price=float(ev.min_price) if ev.min_price is not None else None,
        max_price=float(ev.max_price) if ev.max_price is not None else None,
        currency=ev.currency,
        ticket_url=ev.ticket_url,
        flyer_url=ev.flyer_url,
        is_active=ev.is_active,
        venue_id=str(ev.venue_id),
        venue_name=ev.venue.name if ev.venue else None,
        genres=[eg.genre.name for eg in ev.genres if eg.genre],
    )


@router.get("/events", response_model=EventsPageOut)
def list_admin_events(
    page: int = 1,
    page_size: int = 25,
    search: str = "",
    is_active: bool | None = None,
    admin: User = Depends(get_current_admin_user),
):
    """
    TODOS los eventos (activos e inactivos) -- a diferencia de
    /api/events/map, que solo trae activos (esa es la vista publica del
    mapa; esta es la vista de administracion, donde justamente hace falta
    ver tambien lo que ya se dio de baja). search filtra por nombre;
    is_active, cuando se manda, filtra a uno de los dos estados.
    """
    db = SessionLocal()
    try:
        query = db.query(Event).options(
            joinedload(Event.venue),
            joinedload(Event.genres).joinedload(EventGenre.genre),
        )
        if search:
            query = query.filter(Event.name.ilike(f"%{search}%"))
        if is_active is not None:
            query = query.filter(Event.is_active == is_active)

        total = query.count()
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        events = (
            query.order_by(Event.date_from.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return EventsPageOut(
            items=[_event_to_admin_out(ev) for ev in events],
            total=total,
            page=page,
            page_size=page_size,
        )
    finally:
        db.close()


@router.put("/events/{event_id}", response_model=EventAdminOut)
def update_admin_event(
    event_id: str,
    body: EventUpdateIn,
    admin: User = Depends(get_current_admin_user),
):
    db = SessionLocal()
    try:
        ev = (
            db.query(Event)
            .options(joinedload(Event.venue), joinedload(Event.genres).joinedload(EventGenre.genre))
            .filter(Event.id == event_id)
            .first()
        )
        if ev is None:
            raise HTTPException(status_code=404, detail="Evento no encontrado")

        data = body.model_dump(exclude_unset=True)
        if "venue_id" in data and data["venue_id"]:
            venue = db.query(Venue).filter(Venue.id == data["venue_id"]).first()
            if venue is None:
                raise HTTPException(status_code=404, detail="Venue no encontrado")

        for field, value in data.items():
            setattr(ev, field, value)

        db.commit()
        db.refresh(ev)
        return _event_to_admin_out(ev)
    finally:
        db.close()


@router.delete("/events/{event_id}", status_code=204)
def delete_admin_event(event_id: str, admin: User = Depends(get_current_admin_user)):
    """
    Soft delete -- is_active=False, nunca un DELETE de la fila. Es el
    mismo mecanismo que ya usan /api/events/map (filtro is_active) y el
    chat (rag/query_executor.py) para excluir eventos: un evento dado de
    baja aca desaparece de los dos sin que ninguno tenga que enterarse de
    que existe un panel de admin.
    """
    db = SessionLocal()
    try:
        ev = db.query(Event).filter(Event.id == event_id).first()
        if ev is None:
            raise HTTPException(status_code=404, detail="Evento no encontrado")
        ev.is_active = False
        db.commit()
    finally:
        db.close()


@router.get("/venues", response_model=list[VenueOut])
def search_admin_venues(search: str = "", admin: User = Depends(get_current_admin_user)):
    """
    Busca venues existentes por nombre -- lo usa el frontend tanto para
    elegir a que venue reasignar un evento (Parte 4b) como para mostrar el
    event_count ANTES de mover coordenadas de uno (Parte 4a). event_count
    cuenta solo eventos activos: es "cuantos eventos de hoy se moverian si
    corrijo este venue", no un historial completo.
    """
    db = SessionLocal()
    try:
        query = db.query(Venue)
        if search:
            query = query.filter(Venue.name.ilike(f"%{search}%"))
        venues = query.order_by(Venue.name).limit(20).all()

        venue_ids = [v.id for v in venues]
        counts = {}
        if venue_ids:
            rows = (
                db.query(Event.venue_id, func.count(Event.id))
                .filter(Event.venue_id.in_(venue_ids), Event.is_active == True)
                .group_by(Event.venue_id)
                .all()
            )
            counts = dict(rows)

        result = []
        for v in venues:
            lat, lng = _venue_coords(v)
            result.append(
                VenueOut(
                    id=str(v.id),
                    name=v.name,
                    address=v.address,
                    neighborhood=v.neighborhood,
                    city_name=v.city_name,
                    precision=v.precision,
                    lat=lat,
                    lng=lng,
                    event_count=counts.get(v.id, 0),
                )
            )
        return result
    finally:
        db.close()


@router.post("/venues", response_model=VenueOut)
def create_admin_venue(body: VenueCreateIn, admin: User = Depends(get_current_admin_user)):
    """
    Venue nuevo -- para cuando el evento se mudo a un lugar que todavia no
    existe en la base (Parte 4b, "crear venue nuevo"). Las coordenadas
    vienen de un click del admin en el mapa, asi que quedan marcadas
    "manual" igual que una correccion de coordenadas (ver
    update_venue_coordinates) -- mismo nivel de confianza, mismo valor.
    """
    db = SessionLocal()
    try:
        venue = Venue(
            name=body.name,
            coordinates=ST_GeomFromText(f"POINT({body.lng} {body.lat})", 4326),
            precision="manual",
        )
        db.add(venue)
        db.commit()
        db.refresh(venue)
        return VenueOut(
            id=str(venue.id),
            name=venue.name,
            address=venue.address,
            neighborhood=venue.neighborhood,
            city_name=venue.city_name,
            precision=venue.precision,
            lat=body.lat,
            lng=body.lng,
            event_count=0,
        )
    finally:
        db.close()


@router.put("/venues/{venue_id}/coordinates", response_model=VenueOut)
def update_venue_coordinates(
    venue_id: str,
    body: VenueCoordinatesIn,
    admin: User = Depends(get_current_admin_user),
):
    """
    Mueve las coordenadas de un venue EXISTENTE (Parte 4a, "corregir la
    ubicacion de este venue") -- para cuando el venue esta mal
    geocodificado, no para cuando un evento cambio de lugar (eso es
    reasignar venue_id via PUT /events/{id}, arriba). Afecta a TODOS los
    eventos de este venue, a proposito: son el mismo lugar fisico, mal
    ubicado una sola vez en la base.

    precision se marca "manual" -- ya es una columna de texto libre
    (VARCHAR(20), ver Venue.precision en database/models.py), no un ENUM
    de Postgres, asi que no hace falta ninguna migracion para sumar este
    valor nuevo.
    """
    db = SessionLocal()
    try:
        venue = db.query(Venue).filter(Venue.id == venue_id).first()
        if venue is None:
            raise HTTPException(status_code=404, detail="Venue no encontrado")

        venue.coordinates = ST_GeomFromText(f"POINT({body.lng} {body.lat})", 4326)
        venue.precision = "manual"
        db.commit()
        db.refresh(venue)

        event_count = (
            db.query(func.count(Event.id))
            .filter(Event.venue_id == venue.id, Event.is_active == True)
            .scalar()
        )
        return VenueOut(
            id=str(venue.id),
            name=venue.name,
            address=venue.address,
            neighborhood=venue.neighborhood,
            city_name=venue.city_name,
            precision=venue.precision,
            lat=body.lat,
            lng=body.lng,
            event_count=event_count,
        )
    finally:
        db.close()