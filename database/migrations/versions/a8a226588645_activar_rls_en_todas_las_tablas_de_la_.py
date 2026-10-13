"""activar RLS en todas las tablas de la app

Revision ID: a8a226588645
Revises: 8b38d9e5d895
Create Date: 2026-10-13 10:42:53.018175

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2


# revision identifiers, used by Alembic.
revision: str = 'a8a226588645'
down_revision: Union[str, None] = '8b38d9e5d895'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Todas las tablas propias de la app en el esquema public -- Supabase
# expone cualquier tabla ahi via su API REST autogenerada (PostgREST) a
# quien tenga la clave anon/public, a menos que RLS este activo. Esta
# app jamas usa esa API (se conecta directo por DATABASE_URL), asi que
# la unica puerta valida es el backend FastAPI -- no hace falta ninguna
# policy, alcanza con bloquear esa puerta por completo.
#
# spatial_ref_sys (tabla de PostGIS, datos publicos de sistemas de
# referencia geografica, no datos de la app) queda afuera a proposito:
# es propiedad de supabase_admin, no de este rol, y ALTER TABLE sobre
# ella fallaria por permisos -- ademas no contiene nada sensible.
APP_TABLES = [
    "alembic_version", "cities", "conversation_messages", "conversations",
    "djs", "email_verification_tokens", "event_djs", "event_genres",
    "events", "genres", "oauth_accounts", "password_reset_tokens",
    "refresh_tokens", "sources", "user_event_history",
    "user_genre_preferences", "user_saved_events", "users", "venues",
]


def upgrade() -> None:
    for table in APP_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    for table in APP_TABLES:
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')