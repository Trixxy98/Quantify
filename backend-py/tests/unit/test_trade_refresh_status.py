from unittest.mock import Mock

from app.services import refresh


def test_trade_refresh_reports_completed(monkeypatch) -> None:
    monkeypatch.setattr(refresh, "refresh_portfolio_after_trade", lambda *_: True)
    assert refresh.refresh_portfolio_after_trade_quietly(Mock(), "portfolio", ["AAPL"]) == "complete"


def test_trade_refresh_reports_deferred(monkeypatch) -> None:
    monkeypatch.setattr(refresh, "refresh_portfolio_after_trade", lambda *_: False)
    assert refresh.refresh_portfolio_after_trade_quietly(Mock(), "portfolio", ["AAPL"]) == "pending"


def test_trade_refresh_reports_failure_without_undoing_trade(monkeypatch) -> None:
    db = Mock()

    def fail(*_args) -> None:
        raise RuntimeError("market unavailable")

    monkeypatch.setattr(refresh, "refresh_portfolio_after_trade", fail)
    assert refresh.refresh_portfolio_after_trade_quietly(db, "portfolio", ["AAPL"]) == "failed"
    db.rollback.assert_called_once()
