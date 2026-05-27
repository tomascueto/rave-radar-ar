import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float,
    ForeignKey, Enum, Numeric, DateTime
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from database.connection import Base
import enum


# ─── ENUMS ────────────────────────────────────────────────────────────────────

class EventTypeEnum(str, enum.Enum):
    sunset = "sunset"
    after = "after"
    festival = "festival"
    party = "party"

class AuthProviderEnum(str, enum.Enum):
    google = "google"
    spotify = "spotify"

class UserRoleEnum(str, enum.Enum):
    user = "user"
    admin = "admin"


# ─── MUNDO SCRAPING ───────────────────────────────────────────────────────────

class Venue(Base):
    __tablename__ = "venues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    address = Column(String(300))
    neighborhood = Column(String(100))
    city = Column(String(100))
    province = Column(String(100))
    country = Column(String(100), default="Argentina")
    coordinates = Column(Geometry("POINT", srid=4326))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    events = relationship("Event", back_populates="venue")


class Source(Base):
    __tablename__ = "sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    base_url = Column(String(300))
    is_active = Column(Boolean, default=True)
    last_scraped_at = Column(DateTime(timezone=True))

    events = relationship("Event", back_populates="source")


class Event(Base):
    __tablename__ = "events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=False)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    name = Column(String(300), nullable=False)
    description = Column(Text)
    date_from = Column(DateTime(timezone=True), nullable=False)
    date_to = Column(DateTime(timezone=True))
    min_price = Column(Numeric(10, 2))
    max_price = Column(Numeric(10, 2))
    currency = Column(String(10), default="ARS")
    ticket_url = Column(String(500))
    flyer_url = Column(String(500))
    event_type = Column(Enum(EventTypeEnum))
    is_active = Column(Boolean, default=True)
    external_id = Column(String(200))
    qdrant_id = Column(UUID(as_uuid=True))
    last_scraped_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Campos IA
    vibe_score = Column(String(200))
    ai_summary = Column(Text)
    is_enriched = Column(Boolean, default=False)
    enriched_at = Column(DateTime(timezone=True))

    venue = relationship("Venue", back_populates="events")
    source = relationship("Source", back_populates="events")
    djs = relationship("EventDJ", back_populates="event")
    genres = relationship("EventGenre", back_populates="event")
    saved_by = relationship("UserSavedEvent", back_populates="event")
    history = relationship("UserEventHistory", back_populates="event")


class DJ(Base):
    __tablename__ = "djs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    instagram_handle = Column(String(100))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    events = relationship("EventDJ", back_populates="dj")


class EventDJ(Base):
    __tablename__ = "event_djs"

    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), primary_key=True)
    dj_id = Column(UUID(as_uuid=True), ForeignKey("djs.id"), primary_key=True)
    is_headliner = Column(Boolean, default=False)
    order = Column(Integer)

    event = relationship("Event", back_populates="djs")
    dj = relationship("DJ", back_populates="events")


class Genre(Base):
    __tablename__ = "genres"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    events = relationship("EventGenre", back_populates="genre")
    user_preferences = relationship("UserGenrePreference", back_populates="genre")


class EventGenre(Base):
    __tablename__ = "event_genres"

    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), primary_key=True)
    genre_id = Column(UUID(as_uuid=True), ForeignKey("genres.id"), primary_key=True)
    is_primary = Column(Boolean, default=False)

    event = relationship("Event", back_populates="genres")
    genre = relationship("Genre", back_populates="events")


# ─── MUNDO USUARIO ────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(300), unique=True, nullable=False)
    display_name = Column(String(200))
    avatar_url = Column(String(500))
    is_email_verified = Column(Boolean, default=False)
    price_range_max = Column(Integer)
    preferred_city = Column(String(100))
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user")
    terms_accepted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    oauth_accounts = relationship("OAuthAccount", back_populates="user")
    refresh_tokens = relationship("RefreshToken", back_populates="user")
    email_verification_tokens = relationship("EmailVerificationToken", back_populates="user")
    genre_preferences = relationship("UserGenrePreference", back_populates="user")
    event_history = relationship("UserEventHistory", back_populates="user")
    saved_events = relationship("UserSavedEvent", back_populates="user")


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    provider = Column(Enum(AuthProviderEnum), nullable=False)
    provider_account_id = Column(String(200), nullable=False)
    access_token = Column(Text)
    expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="oauth_accounts")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(500), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_revoked = Column(Boolean, default=False)
    device_info = Column(String(200))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(500), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="email_verification_tokens")


class UserGenrePreference(Base):
    __tablename__ = "user_genre_preferences"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    genre_id = Column(UUID(as_uuid=True), ForeignKey("genres.id"), primary_key=True)
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="genre_preferences")
    genre = relationship("Genre", back_populates="user_preferences")


class UserEventHistory(Base):
    __tablename__ = "user_event_history"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), primary_key=True)
    attended_at = Column(DateTime(timezone=True))
    rating = Column(Integer)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="event_history")
    event = relationship("Event", back_populates="history")


class UserSavedEvent(Base):
    __tablename__ = "user_saved_events"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"), primary_key=True)
    saved_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="saved_events")
    event = relationship("Event", back_populates="saved_by")