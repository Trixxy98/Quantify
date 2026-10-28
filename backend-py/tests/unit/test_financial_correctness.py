from datetime import UTC, datetime

import pytest

from app.services.corporate_actions import SplitRow, adjust_trade, split_factor_after
from app.services.fx import fx_bar_date, to_base
from app.services.metrics import time_weighted_index
from app.services.momentum import build_level
from app.timeutil import ms


def test_time_weighted_index_removes_deposits_and_withdrawals_but_includes_income() -> None:
    # 100 -> 150 with a 50 deposit is flat; 150 -> 135 after a 30 withdrawal
    # and 15 dividend income is a 20% total return.
    values = [
        {"date": "2025-01-01", "value": 100.0},
        {"date": "2025-01-02", "value": 150.0},
        {"date": "2025-01-03", "value": 135.0},
    ]
    result = time_weighted_index(values, {"2025-01-02": 50, "2025-01-03": -30}, {"2025-01-03": 15})
    assert [point["value"] for point in result] == pytest.approx([100, 100, 120])


def test_fx_conversion_uses_last_available_rate_and_inverse_for_usd_base() -> None:
    series = [{"date": 1000, "close": 4.0}, {"date": 3000, "close": 4.4}]
    assert to_base(100, "USD", "MYR", series, 2000) == pytest.approx(400)
    assert to_base(440, "MYR", "USD", series, 3000) == pytest.approx(100)
    assert to_base(100, "USD", "MYR", series, 999) is None
    assert to_base(100, "MYR", "MYR", [], 999) == 100
    # London midnight falls on the previous UTC day during summer time.
    assert fx_bar_date(datetime(2025, 7, 1, 23, tzinfo=UTC)) == datetime(2025, 7, 2)


def test_split_adjusts_only_trades_before_split_and_preserves_cost() -> None:
    split = SplitRow(datetime(2025, 1, 3), 2, 1)
    before = ms(datetime(2025, 1, 2))
    on_date = ms(datetime(2025, 1, 3))
    assert split_factor_after([split], before) == 2
    adjusted = adjust_trade(10, 40, [split], before)
    assert adjusted == {"quantity": 20, "price": 20}
    assert adjust_trade(10, 40, [split], on_date) == {"quantity": 10, "price": 40}
    assert adjusted["quantity"] * adjusted["price"] == 400


def test_total_return_index_adds_all_dividends_on_ex_date() -> None:
    closes = [
        {"date": "2025-01-01", "close": 100},
        {"date": "2025-01-02", "close": 95},
        {"date": "2025-01-03", "close": 104.5},
    ]
    dividends = [{"date": "2025-01-02", "amount": 3}, {"date": "2025-01-02", "amount": 2}]
    # Both distributions cover the five-point ex-date price drop; next day rises 10%.
    assert [point["level"] for point in build_level(closes, dividends)] == pytest.approx([100, 100, 110])
