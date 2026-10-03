"""Baseline: the schema Prisma built, up to migration 20261003040654_agents.

An existing database (built by Prisma) is brought under Alembic with
`alembic stamp head`, which runs nothing. On an empty database
`alembic upgrade head` creates the same schema from the SQL Prisma
generated (`prisma migrate diff --from-empty`, stored next to this file).

Revision ID: 0001_prisma_baseline
Revises:
Create Date: 2026-10-03
"""

from pathlib import Path

import sqlalchemy as sa

from alembic import op

revision = "0001_prisma_baseline"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_SQL = Path(__file__).with_suffix(".sql")


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("User"):
        return
    for statement in SCHEMA_SQL.read_text().split(";"):
        lines = [line for line in statement.splitlines() if line.strip() and not line.strip().startswith("--")]
        if lines:
            op.execute("\n".join(lines))


def downgrade() -> None:
    raise NotImplementedError("The baseline is not reversible; restore from a backup instead.")
