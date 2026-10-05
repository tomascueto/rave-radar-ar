"""ampliar flyer_url y ticket_url a TEXT -- las URLs de Instagram superan los 500 caracteres

Revision ID: 73d041bc036a
Revises: 19536e2a1b9d
Create Date: 2026-10-05

VARCHAR(500) alcanzaba para la mayoria de los links, pero las URLs de
imagenes del CDN de Instagram incluyen tokens de firma y cache que las
hacen superar ese largo con frecuencia -- no es un caso raro, es el
formato normal de esas URLs. ticket_url se amplia por el mismo motivo,
preventivamente: aunque el caso que disparo esto fue flyer_url, varias
plataformas de venta de entradas tambien generan URLs largas con
parametros de tracking.

No hay ninguna razon practica para limitar una URL a un largo arbitrario
-- TEXT no tiene costo real frente a VARCHAR(500) para este uso.
"""
from alembic import op
import sqlalchemy as sa

revision = '73d041bc036a'
down_revision = '19536e2a1b9d'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('events', 'flyer_url', type_=sa.Text())
    op.alter_column('events', 'ticket_url', type_=sa.Text())


def downgrade():
    op.alter_column('events', 'flyer_url', type_=sa.String(500))
    op.alter_column('events', 'ticket_url', type_=sa.String(500))
