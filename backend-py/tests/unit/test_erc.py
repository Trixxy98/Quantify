import pytest

from app.services.risk_math import constant_correlation_shrink, erc_weights, portfolio_risk


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
