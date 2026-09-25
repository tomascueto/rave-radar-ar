"""reemplazar preferred_city (texto libre) por preferred_city_id (FK a cities) en users

Revision ID: 7e778fa40bad
Revises: 2717f9da721e
Create Date: 2026-09-22 22:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2


# revision identifiers, used by Alembic.
revision: str = '7e778fa40bad'
down_revision: Union[str, None] = '2717f9da721e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('users', 'preferred_city')
    op.add_column('users', sa.Column('preferred_city_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_users_preferred_city_id_cities', 'users', 'cities',
        ['preferred_city_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_users_preferred_city_id_cities', 'users', type_='foreignkey')
    op.drop_column('users', 'preferred_city_id')
    op.add_column('users', sa.Column('preferred_city', sa.String(length=100), nullable=True))
