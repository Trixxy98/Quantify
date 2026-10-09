"""Sign convention: a later rise helps a buy and hurts a sell."""

import pytest

from app.research.timing import mark_fill, summarize


def _bars() -> list[tuple[str, float]]:
    days = [f"2026-01-{day:02d}" for day in range(2, 32)]
    return [(day, 100.0 if index == 0 else 110.0) for index, day in enumerate(days)]


def test_buy_then_rise_is_positive_and_sell_then_rise_is_negative() -> None:
    bars = _bars()
    buy = mark_fill("BUY", 100.0, "2026-01-02", bars)
    sell = mark_fill("SELL", 100.0, "2026-01-02", bars)
    assert buy["sameDay"] == pytest.approx(0)
    assert buy["sessions5"] == pytest.approx(1000)
    assert buy["sessions20"] == pytest.approx(1000)
    assert sell["sessions5"] == pytest.approx(-1000)
    assert sell["sessions20"] == pytest.approx(-1000)


def test_missing_future_session_is_blank() -> None:
    marks = mark_fill("BUY", 50.0, "2026-01-02", [("2026-01-02", 55.0), ("2026-01-05", 60.0)])
    assert marks["sameDay"] == pytest.approx(1000)
    assert marks["sessions5"] is None


def test_summary_withholds_a_claim_below_thirty_trades() -> None:
    fills = [("BUY", mark_fill("BUY", 100.0, "2026-01-02", _bars()))]
    summary = summarize(fills)
    assert "30" in str(summary["note"])
    buy_same = next(row for row in summary["rows"] if row["side"] == "BUY" and row["horizon"] == "sameDay")
    assert buy_same["n"] == 1
    assert buy_same["meanBps"] == 0
