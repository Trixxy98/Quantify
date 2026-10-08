"""Store earnings announcement dates for the Event agent.

Revision ID: 0002_earnings_date
Revises: 0001_prisma_baseline
Create Date: 2026-10-08
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_earnings_date"
down_revision = "0001_prisma_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "EarningsDate",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("recordedAt", sa.DateTime(), nullable=False),
    )
    op.create_index("EarningsDate_symbol_date_key", "EarningsDate", ["symbol", "date"], unique=True)


def downgrade() -> None:
    op.drop_index("EarningsDate_symbol_date_key", table_name="EarningsDate")
    op.drop_table("EarningsDate")
