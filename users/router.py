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
from database.models import EventGenre, Genre, User, UserGenrePreference

router = APIRouter(prefix="/api/users", tags=["users"])


def get_user_genre_ids(db: Session, user_id) -> set[str]:
    """Reutilizado tanto por /me/genres como por /api/chat (para
    personalizar el orden de resultados de un usuario logueado)."""
    prefs = db.query(UserGenrePreference).filter(UserGenrePreference.user_id == user_id).all()
    return {str(p.genre_id) for p in prefs}


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