import pytest

from app.models import Exchange
from app.services.risk import _erc
from app.services.risk_math import constant_correlation_shrink, erc_weights, minimum_variance_weights, portfolio_risk
from app.services.valuation import OpenPositionMark


def test_two_assets_match_the_inverse_volatility_weights():
    cov = [[0.04, 0.01], [0.01, 0.01]]
    weights = erc_weights(cov)
    assert weights is not None
    assert weights[0] == pytest.approx(1 / 3)
    assert weights[1] == pytest.approx(2 / 3)


def test_identical_assets_split_equally():
    cov = [[0.04, 0.02, 0.02], [0.02, 0.04, 0.02], [0.02, 0.02, 0.04]]
    weights = erc_weights(cov)
    assert weights is not None
    assert weights == [pytest.approx(1 / 3)] * 3


def test_weights_stay_long_only_and_sum_to_one():
    cov = [[0.09, 0.01, 0.0], [0.01, 0.01, 0.002], [0.0, 0.002, 0.04]]
    weights = erc_weights(cov)
    assert weights is not None
    assert all(weight >= 0 for weight in weights)
    assert sum(weights) == pytest.approx(1)
    parts = portfolio_risk(weights, cov)
    assert max(parts["share"]) - min(parts["share"]) < 1e-6


def test_a_hedge_keeps_a_positive_weight():
    cov = [[0.04, -0.01, 0.005], [-0.01, 0.01, 0.0], [0.005, 0.0, 0.03]]
    weights = erc_weights(cov)
    assert weights is not None
    assert all(weight > 0.01 for weight in weights)
    parts = portfolio_risk(weights, cov)
    assert max(parts["share"]) - min(parts["share"]) < 1e-6


def test_shrinkage_intensity_stays_inside_zero_and_one():
    columns = [
        [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.0, -0.005],
        [0.03, -0.01, 0.0, 0.02, -0.04, 0.01, 0.005, -0.002],
    ]
    _, intensity = constant_correlation_shrink(columns)
    assert 0 <= intensity <= 1


def test_minimum_variance_is_inverse_variance_when_uncorrelated():
    cov = [[0.04, 0.0], [0.0, 0.01]]
    weights = minimum_variance_weights(cov)
    assert weights is not None
    assert weights[0] == pytest.approx(0.2)
    assert weights[1] == pytest.approx(0.8)
    assert portfolio_risk(weights, cov)["sigma"] < portfolio_risk(erc_weights(cov), cov)["sigma"]


def test_minimum_variance_matches_equal_weights_when_assets_match():
    cov = [[0.04, 0.02, 0.02], [0.02, 0.04, 0.02], [0.02, 0.02, 0.04]]
    weights = minimum_variance_weights(cov)
    assert weights is not None
    assert weights == [pytest.approx(1 / 3)] * 3
    assert all(weight >= 0 for weight in weights)
    assert sum(weights) == pytest.approx(1)


@pytest.mark.parametrize("usd_to_myr", [1, 4])
def test_erc_share_suggestions_use_base_currency_prices(usd_to_myr):
    marks = {
        "LOCAL": OpenPositionMark("LOCAL", Exchange.BURSA, "MYR", 10, 100, 1000, 100, None, 1000, None, None),
        "FOREIGN": OpenPositionMark(
            "FOREIGN", Exchange.US, "USD", 10, 100, 1000, 100, None, 1000 * usd_to_myr, None, None
        ),
    }
    total_value = sum(mark.market_value for mark in marks.values())
    current = [marks[symbol].market_value / total_value for symbol in marks]
    columns = [[0.1, -0.1] * 20, [0.05, 0.05, -0.05, -0.05] * 10]
    erc = _erc(list(marks), current, columns, [[0.04, 0], [0, 0.01]], marks, total_value, True)

    assert erc is not None
    for trade in erc["trades"]:
        mark = marks[trade["symbol"]]
        base_price = mark.last_price * (usd_to_myr if mark.currency == "USD" else 1)
        for weight_key, shares_key in (
            ("sampleWeight", "sampleShares"),
            ("shrunkWeight", "shrunkShares"),
            ("minVarWeight", "minVarShares"),
        ):
            assert trade[shares_key] == round((trade[weight_key] - trade["currentWeight"]) * total_value / base_price)
