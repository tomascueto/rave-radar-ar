"""
Endpoints relacionados al perfil del usuario logueado: catalogo de generos
y generos favoritos (encuesta de onboarding). Separado de auth/router.py
a proposito -- ese es puramente sesion/login, esto es datos de un usuario
ya autenticado, y va a crecer (zona, precio, historial) sin tocar auth.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth.dependencies import get_current_user, get_db
from database.models import EventGenre, Genre, User, UserGenrePreference, UserSavedEvent

router = APIRouter(prefix="/api/users", tags=["users"])


def get_user_genre_ids(db: Session, user_id) -> set[str]:
    """Reutilizado por /me/genres, para saber que ya selecciono el
    usuario (la encuesta lo necesita como set simple, sin pesos)."""
    prefs = db.query(UserGenrePreference).filter(UserGenrePreference.user_id == user_id).all()
    return {str(p.genre_id) for p in prefs}


def get_user_genre_weights(db: Session, user_id) -> dict[str, float]:
    """Reutilizado por /api/chat, para el reordenamiento graduado por
    afinidad (Sección del agente) -- a diferencia de get_user_genre_ids,
    expone el peso real de cada preferencia, no solo si existe."""
    prefs = db.query(UserGenrePreference).filter(UserGenrePreference.user_id == user_id).all()
    return {str(p.genre_id): p.weight for p in prefs}


class GenreOut(BaseModel):
    id: str
    name: str
    slug: str
    event_count: int


class GenrePreferencesIn(BaseModel):
    genre_ids: list[str]


@router.get("/genres/catalog", response_model=list[GenreOut])
def list_genres(db: Session = Depends(get_db)):
    """
    Catalogo completo de generos, ordenado por popularidad real (cuantos
    eventos lo usan) -- no alfabetico ni al azar, para que la encuesta
    muestre primero lo mas relevante en un catalogo de ~70 generos.
    Publico, no requiere sesion: se usa para poblar la encuesta.
    """
    rows = (
        db.query(Genre, func.count(EventGenre.event_id).label("event_count"))
        .outerjoin(EventGenre, EventGenre.genre_id == Genre.id)
        .group_by(Genre.id)
        .order_by(func.count(EventGenre.event_id).desc())
        .all()
    )
    return [
        GenreOut(id=str(genre.id), name=genre.name, slug=genre.slug, event_count=count)
        for genre, count in rows
    ]


@router.get("/me/genres", response_model=list[str])
def get_my_genre_preferences(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ids de los generos que el usuario ya marco como favoritos. Lista
    vacia significa que todavia no completo la encuesta."""
    return list(get_user_genre_ids(db, user.id))


@router.get("/me/genre-weights", response_model=dict[str, float])
def get_my_genre_weights(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pesos por genero (genre_id -> weight), para que el frontend calcule
    la afinidad de cada evento del lado del cliente -- así el color de un
    pin refleja siempre las preferencias actuales, sin importar cuándo se
    recuperó ese evento en particular (un resultado viejo del chat, por
    ejemplo, no queda con un color desactualizado)."""
    return get_user_genre_weights(db, user.id)


@router.put("/me/genres")
def set_my_genre_preferences(
    body: GenrePreferencesIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Reemplaza por completo el conjunto de generos favoritos del usuario --
    semantica simple de "set", no de agregar/quitar de a uno. Encaja con
    una encuesta que se manda entera de una sola vez.
    """
    try:
        db.query(UserGenrePreference).filter(UserGenrePreference.user_id == user.id).delete()
        for genre_id in body.genre_ids:
            db.add(UserGenrePreference(user_id=user.id, genre_id=uuid.UUID(genre_id)))
        db.commit()
    except (ValueError, SQLAlchemyError):
        db.rollback()
        raise HTTPException(status_code=400, detail="No se pudieron guardar las preferencias")

    return {"saved": len(body.genre_ids)}


class UpdateNameIn(BaseModel):
    display_name: str


@router.put("/me/name")
def update_display_name(
    body: UpdateNameIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    if len(name) > 200:
        raise HTTPException(status_code=400, detail="El nombre es demasiado largo")

    db_user = db.query(User).filter(User.id == user.id).first()
    db_user.display_name = name
    db.commit()

    return {"display_name": db_user.display_name}


@router.post("/me/saved-events/{event_id}")
def save_event(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        event_uuid = uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="ID de evento inválido")

    existing = db.query(UserSavedEvent).filter(
        UserSavedEvent.user_id == user.id, UserSavedEvent.event_id == event_uuid
    ).first()
    if existing:
        return {"saved": True}  # ya estaba guardado -- idempotente, no es error

    db.add(UserSavedEvent(user_id=user.id, event_id=event_uuid))
    db.commit()
    return {"saved": True}


@router.delete("/me/saved-events/{event_id}")
def unsave_event(
    event_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        event_uuid = uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="ID de evento inválido")

    db.query(UserSavedEvent).filter(
        UserSavedEvent.user_id == user.id, UserSavedEvent.event_id == event_uuid
    ).delete()
    db.commit()
    return {"saved": False}


@router.get("/me/saved-events/ids", response_model=list[str])
def get_saved_event_ids(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Solo los ids guardados -- para que el frontend sepa que pines/corazones
    marcar sin tener que traer el detalle completo de cada evento. El detalle
    completo vive en GET /api/users/me/saved-events, en api_events.py (evita
    una importación circular, ver nota ahí)."""
    rows = db.query(UserSavedEvent.event_id).filter(UserSavedEvent.user_id == user.id).all()
    return [str(r[0]) for r in rows]