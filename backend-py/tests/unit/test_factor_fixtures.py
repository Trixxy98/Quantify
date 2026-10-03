import pytest

from app.research import french, ols
from tests.fixtures_util import check_module

REGISTRY = {
    "ols.ols": ols.ols,
    "french.parseFrenchDaily": french.parse_french_daily,
}


def test_factor_models_match_typescript() -> None:
    # statsmodels' pseudo-inverse solve replaces the hand-written Gauss–Jordan one.
    check_module("factors", REGISTRY, rel=1e-6)


def test_collinear_regressors_are_rejected() -> None:
    x = [[float(i), 2.0 * i] for i in range(20)]
    with pytest.raises(ols.CollinearError):
        ols.ols([float(i) for i in range(20)], x, 0)
