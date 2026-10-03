from typing import Any

from fastapi import APIRouter, Body, Request, Response

from app.deps import Db, UserId
from app.jsonenc import NodeRoute
from app.schemas import CreatePortfolioBody, RangeQuery, TransactionBody, TransactionsQuery, UpdatePortfolioBody
from app.services import dashboard
from app.services import portfolio as portfolio_service
from app.validation import parse_body

router = APIRouter(route_class=NodeRoute)


def _range(request: Request) -> RangeQuery:
    return parse_body(RangeQuery, dict(request.query_params))


@router.get("")
def list_portfolios(db: Db, user_id: UserId) -> Any:
    return portfolio_service.list_portfolios(db, user_id)


@router.post("", status_code=201)
def create_portfolio(db: Db, user_id: UserId, payload: Any = Body(None)) -> Any:
    body = parse_body(CreatePortfolioBody, payload)
    return portfolio_service.create_portfolio(db, user_id, body.name, body.baseCurrency)


@router.get("/{portfolio_id}")
def get_portfolio(portfolio_id: str, db: Db, user_id: UserId) -> Any:
    from app.rows import row_dict

    return row_dict(portfolio_service.get_owned_portfolio(db, portfolio_id, user_id))


@router.patch("/{portfolio_id}")
def update_portfolio(portfolio_id: str, db: Db, user_id: UserId, payload: Any = Body(None)) -> Any:
    body = parse_body(UpdatePortfolioBody, payload)
    return portfolio_service.update_portfolio(db, portfolio_id, user_id, body.model_dump(exclude_unset=True, exclude_none=True))


@router.delete("/{portfolio_id}", status_code=204)
def delete_portfolio(portfolio_id: str, db: Db, user_id: UserId) -> Response:
    portfolio_service.delete_portfolio(db, portfolio_id, user_id)
    return Response(status_code=204)


@router.get("/{portfolio_id}/holdings")
def holdings(portfolio_id: str, db: Db, user_id: UserId) -> Any:
    return portfolio_service.list_holdings(db, portfolio_id, user_id)


@router.get("/{portfolio_id}/closed-lots")
def closed_lots(portfolio_id: str, db: Db, user_id: UserId) -> Any:
    return portfolio_service.list_closed_lots(db, portfolio_id, user_id)


@router.get("/{portfolio_id}/summary")
def summary(portfolio_id: str, db: Db, user_id: UserId) -> Any:
    return dashboard.get_summary(db, portfolio_id, user_id)


@router.get("/{portfolio_id}/metrics")
def metrics(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    return dashboard.get_metrics(db, portfolio_id, user_id, _range(request).range)


@router.get("/{portfolio_id}/performance")
def performance(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    return dashboard.get_performance(db, portfolio_id, user_id, _range(request).range)


@router.get("/{portfolio_id}/allocation")
def allocation(portfolio_id: str, db: Db, user_id: UserId) -> Any:
    return dashboard.get_allocation(db, portfolio_id, user_id)


@router.get("/{portfolio_id}/analysis")
def analysis(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    from app.services.analysis import get_analysis

    return get_analysis(db, portfolio_id, user_id, _range(request).range)


@router.get("/{portfolio_id}/risk")
def risk(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    from app.services.risk import get_risk

    query = _range(request)
    return get_risk(db, portfolio_id, user_id, query.range, query.window)


@router.get("/{portfolio_id}/factors")
def factors(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    from app.services.factors import get_factor_exposure

    return get_factor_exposure(db, portfolio_id, user_id, _range(request).range)


@router.get("/{portfolio_id}/prices/{symbol}")
def price_series(portfolio_id: str, symbol: str, request: Request, db: Db, user_id: UserId) -> Any:
    return dashboard.get_price_series(db, portfolio_id, user_id, symbol, _range(request).range)


@router.get("/{portfolio_id}/transactions")
def list_transactions(portfolio_id: str, request: Request, db: Db, user_id: UserId) -> Any:
    query = parse_body(TransactionsQuery, dict(request.query_params))
    return portfolio_service.list_transactions(db, portfolio_id, user_id, query.symbol, query.page, query.limit)


@router.post("/{portfolio_id}/transactions", status_code=201)
def create_transaction(portfolio_id: str, db: Db, user_id: UserId, payload: Any = Body(None)) -> Any:
    body = parse_body(TransactionBody, payload)
    return portfolio_service.create_transaction(db, portfolio_id, user_id, body.model_dump())


@router.patch("/{portfolio_id}/transactions/{tx_id}")
def update_transaction(portfolio_id: str, tx_id: str, db: Db, user_id: UserId, payload: Any = Body(None)) -> Any:
    body = parse_body(TransactionBody, payload)
    return portfolio_service.update_transaction(db, portfolio_id, tx_id, user_id, body.model_dump())


@router.delete("/{portfolio_id}/transactions/{tx_id}", status_code=204)
def delete_transaction(portfolio_id: str, tx_id: str, db: Db, user_id: UserId) -> Response:
    portfolio_service.delete_transaction(db, portfolio_id, tx_id, user_id)
    return Response(status_code=204)
