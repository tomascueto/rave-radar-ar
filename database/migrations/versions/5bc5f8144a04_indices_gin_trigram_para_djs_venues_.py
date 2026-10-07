"""indices GIN trigram para djs venues genres cities

Revision ID: 5bc5f8144a04
Revises: 73d041bc036a
Create Date: 2026-10-06 11:38:27.853824

Preparan las busquedas de rag/entity_resolver.py (similarity/word_similarity,
pg_trgm) para cuando las tablas crezcan -- hoy (997 djs, 240 venues, 47
generos, 31 ciudades) Postgres sigue prefiriendo seq scan sobre el indice
(confirmado con EXPLAIN ANALYZE: el planner lo descarta por ser mas caro a
este volumen), asi que esto no cambia performance todavia. Tampoco alcanza
por si solo: para que el planner elija el indice hace falta ademas
reescribir las queries de entity_resolver.py con los operadores %/<% de
pg_trgm en vez de llamar a similarity()/word_similarity() directo en el
WHERE (verificado: con la query actual, el indice queda sin usar incluso
estando creado) -- eso es un cambio aparte, pendiente para cuando el
volumen de datos lo justifique.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2


# revision identifiers, used by Alembic.
revision: str = '5bc5f8144a04'
down_revision: Union[str, None] = '73d041bc036a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Los indices GIN con gin_trgm_ops requieren esta extension -- ya esta
    # habilitada en la base actual (la usa rag/entity_resolver.py desde
    # antes de esta migracion), pero sin esto una base nueva o distinta
    # (otro entorno, un fork) fallaria al crear los indices.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX IF NOT EXISTS idx_djs_name_trgm ON djs USING GIN (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_venues_name_trgm ON venues USING GIN (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_genres_name_trgm ON genres USING GIN (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_cities_name_trgm ON cities USING GIN (name gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_djs_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_venues_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_genres_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_cities_name_trgm")