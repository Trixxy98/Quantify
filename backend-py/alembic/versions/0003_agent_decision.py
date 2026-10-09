"""Record one-month decision-engine rows.

Revision ID: 0003_agent_decision
Revises: 0002_earnings_date
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "0003_agent_decision"
down_revision = "0002_earnings_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "AgentDecision",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("asOf", sa.Date(), nullable=False),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("weight", sa.Numeric(18, 10), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("rules", sa.Text(), nullable=False),
        sa.Column("createdAt", sa.DateTime(), nullable=False),
    )
    op.create_index("AgentDecision_asOf_symbol_key", "AgentDecision", ["asOf", "symbol"], unique=True)


def downgrade() -> None:
    op.drop_index("AgentDecision_asOf_symbol_key", table_name="AgentDecision")
    op.drop_table("AgentDecision")
