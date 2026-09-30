"""agregar is_admin a users, para el panel de administracion

Revision ID: 19536e2a1b9d
Revises: 7e778fa40bad
Create Date: 2026-09-29

No hay ningun flujo en la app para otorgar este permiso -- a proposito.
Se activa a mano, directo en la base, para el/los usuarios que corresponda:

    UPDATE users SET is_admin = true WHERE email = 'tu-email@ejemplo.com';

Si en algun momento hace falta una UI para gestionar esto (dar/sacar admin
a otros usuarios), esa UI misma tendria que estar protegida por
get_current_admin_user -- no se construye ahora porque no hace falta
todavia, y cada superficie nueva de este tipo es una superficie mas para
asegurar bien.
"""
from alembic import op
import sqlalchemy as sa

revision = '19536e2a1b9d'
down_revision = '7e778fa40bad'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('users', 'is_admin')
