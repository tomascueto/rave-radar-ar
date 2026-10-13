"""bloqueo de cuenta por intentos fallidos de login

Revision ID: 8b38d9e5d895
Revises: 5bc5f8144a04
Create Date: 2026-10-12 21:40:16.447702

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2


# revision identifiers, used by Alembic.
revision: str = '8b38d9e5d895'
down_revision: Union[str, None] = '5bc5f8144a04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Las columnas de indices GIN trigram e is_admin que el autogenerate
    # detecto como "drift" son ruido de esta base local contra el estado
    # real de las migraciones anteriores -- no son parte de este cambio,
    # se omiten a mano. Solo agregamos lo que corresponde a este fix.
    op.add_column('users', sa.Column(
        'failed_login_attempts', sa.Integer(), nullable=False, server_default='0'
    ))
    op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'failed_login_attempts')