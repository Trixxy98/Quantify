"""
Live contract diff: calls every GET endpoint on the Node API and on this API
with the same access token and parameters, and reports where the JSON differs.

Both APIs share JWT_ACCESS_SECRET, so a token minted here for a user works on
both. The token is short-lived and never leaves the machine.

    uv run python -m tests.contract.diff --email you@example.com [--only ledger]
    uv run pytest -m contract            # same, as a test (QUANTIFY_EMAIL must be set)
"""

import argparse
import math
import os
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Holding, Portfolio, Transaction, User
from app.security import sign_access_token

NODE = os.environ.get("NODE_API", "http://localhost:4000")
PY = os.environ.get("PY_API", "http://localhost:8000")
REL_TOL = 1e-6
ABS_TOL = 1e-9
# Keys that are wall-clock or live-market values on every call.
VOLATILE_KEYS = {"generatedAt", "timestamp", "fetchedAt", "asOfTime", "quoteTime", "latestUpdate"}


@dataclass
class Case:
    group: str
    path: str
    params: dict[str, Any] = field(default_factory=dict)
    # "exact": values must match; "shape": live market data, only keys and types are compared.
    mode: str = "exact"


@dataclass
class Difference:
    case: Case
    where: str
    node: Any
    py: Any


def _close(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)


def compare(node: Any, py: Any, where: str, mode: str, out: list[tuple[str, Any, Any]]) -> None:
    if isinstance(node, dict) and isinstance(py, dict):
        for key in sorted(set(node) | set(py)):
            if key in VOLATILE_KEYS:
                continue
            if key not in node or key not in py:
                out.append((f"{where}.{key}", node.get(key, "<missing>"), py.get(key, "<missing>")))
                continue
            compare(node[key], py[key], f"{where}.{key}", mode, out)
        return
    if isinstance(node, list) and isinstance(py, list):
        if len(node) != len(py) and mode == "exact":
            out.append((f"{where}.length", len(node), len(py)))
        for index, (a, b) in enumerate(zip(node, py, strict=False)):
            compare(a, b, f"{where}[{index}]", mode, out)
        return
    if mode == "shape":
        both_numbers = isinstance(node, (int, float)) and isinstance(py, (int, float))
        if (node is None) != (py is None) and not both_numbers and type(node) is not type(py):
            out.append((where, type(node).__name__, type(py).__name__))
        return
    if isinstance(node, (int, float)) and isinstance(py, (int, float)) and not isinstance(node, bool):
        if not _close(float(node), float(py)):
            out.append((where, node, py))
        return
    if node != py:
        out.append((where, node, py))


def cases_for(user_id: str) -> list[Case]:
    with SessionLocal() as db:
        portfolios = db.scalars(select(Portfolio).where(Portfolio.user_id == user_id).order_by(Portfolio.created_at)).all()
        out: list[Case] = [Case("ledger", "/api/portfolios")]
        for portfolio in portfolios:
            base = f"/api/portfolios/{portfolio.id}"
            out += [
                Case("ledger", base),
                Case("ledger", f"{base}/holdings"),
                Case("ledger", f"{base}/closed-lots"),
                Case("ledger", f"{base}/summary"),
                Case("ledger", f"{base}/transactions", {"limit": 100}),
            ]
            for range_ in ("1M", "1Y", "YTD", "ALL"):
                out += [
                    Case("ledger", f"{base}/performance", {"range": range_}),
                    Case("ledger", f"{base}/allocation", {"range": range_}),
                    Case("risk", f"{base}/metrics", {"range": range_}),
                    Case("risk", f"{base}/analysis", {"range": range_}),
                    Case("factors", f"{base}/factors", {"range": range_}),
                ]
            for window in (20, 60):
                out.append(Case("risk", f"{base}/risk", {"range": "1Y", "window": window}))
            symbols = db.scalars(select(Holding.symbol).where(Holding.portfolio_id == portfolio.id)).all()
            traded = db.scalars(select(Transaction.symbol).where(Transaction.portfolio_id == portfolio.id).distinct()).all()
            for symbol in sorted(set(symbols) | set(traded))[:4]:
                out.append(Case("ledger", f"{base}/prices/{symbol}", {"range": "1Y"}))
        first = portfolios[0].id if portfolios else None
    out += [
        Case("market", "/api/market/close", {"symbol": "AAPL", "date": "2026-06-15"}),
        Case("market", "/api/market/search", {"q": "apple"}, mode="shape"),
        Case("market", "/api/market/quotes", {"symbols": "AAPL,1155.KL"}, mode="shape"),
        Case("options", "/api/market/iv-surface", {"symbol": "SPY"}, mode="shape"),
        Case("data", "/api/market/health"),
        Case("events", "/api/events/study", {"symbols": "SPY,AAPL", "type": "FOMC", "years": 5}),
        Case("events", "/api/events/study", {"symbols": "AAPL,MSFT", "type": "EARNINGS", "years": 3, "pre": 3, "post": 5}),
        Case("events", "/api/events/premium", {"symbol": "SPY", "type": "FOMC", "years": 5}, mode="shape"),
        Case("research", "/api/research/momentum", {"universe": "basket"}),
        Case("research", "/api/research/agents"),
    ]
    if first:
        out.append(Case("research", "/api/research/momentum", {"universe": "holdings", "portfolioId": first}))
    return out


def run(email: str, only: Iterable[str] | None = None) -> list[Difference]:
    with SessionLocal() as db:
        user = db.scalars(select(User).where(User.email == email)).first()
        if user is None:
            raise SystemExit(f"no user {email}")
        user_id = user.id
    token = sign_access_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    groups = set(only) if only else None
    differences: list[Difference] = []
    statuses: dict[int, int] = {}
    with httpx.Client(timeout=300) as client:
        for case in cases_for(user_id):
            if groups and case.group not in groups:
                continue
            node = client.get(NODE + case.path, params=case.params, headers=headers)
            py = client.get(PY + case.path, params=case.params, headers=headers)
            statuses[node.status_code] = statuses.get(node.status_code, 0) + 1
            if node.status_code != py.status_code:
                differences.append(Difference(case, "status", node.status_code, py.status_code))
                continue
            found: list[tuple[str, Any, Any]] = []
            compare(node.json(), py.json(), "$", case.mode, found)
            differences += [Difference(case, where, a, b) for where, a, b in found]
    print(f"checked {sum(statuses.values())} responses, Node status codes {statuses}")
    return differences


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default=os.environ.get("QUANTIFY_EMAIL"))
    parser.add_argument("--only", action="append", help="ledger, risk, factors, market, options, data, events, research")
    parser.add_argument("--max", type=int, default=40, help="differences to print")
    args = parser.parse_args()
    if not args.email:
        raise SystemExit("--email or QUANTIFY_EMAIL is required")
    differences = run(args.email, args.only)
    for diff in differences[: args.max]:
        print(f"{diff.case.path} {diff.case.params} {diff.where}: node={diff.node!r} py={diff.py!r}")
    by_case = {(d.case.path, str(d.case.params)) for d in differences}
    print(f"{len(differences)} differences in {len(by_case)} responses")
    sys.exit(1 if differences else 0)


if __name__ == "__main__":
    main()
