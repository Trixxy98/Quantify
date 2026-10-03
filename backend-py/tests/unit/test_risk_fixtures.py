from app.research import bootstrap
from app.services import metrics, risk_math
from tests.fixtures_util import check_module


def _mean(values: list[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def _random_sequence(seed: int, n: int) -> list[float]:
    random = bootstrap.seeded_random(seed)
    return [random() for _ in range(n)]


REGISTRY = {
    "risk.garmanKlassDaily": risk_math.garman_klass_daily,
    "risk.annualizedVolFromDailyVariances": risk_math.annualized_vol_from_daily_variances,
    "risk.quantile": risk_math.quantile,
    "risk.expectedShortfall": risk_math.expected_shortfall,
    "risk.kupiecStatistic": risk_math.kupiec_statistic,
    "risk.sampleCovarianceMatrix": risk_math.sample_covariance_matrix,
    "risk.correlationMatrix": risk_math.correlation_matrix,
    "risk.portfolioRisk": risk_math.portfolio_risk,
    "risk.ulcerIndex": risk_math.ulcer_index,
    "risk.drawdownEpisodes": risk_math.drawdown_episodes,
    "risk.rollingVolBeta": risk_math.rolling_vol_beta,
    "bootstrap.seededRandom": _random_sequence,
    "bootstrap.stationaryBootstrapIndices": lambda n, block, seed: bootstrap.stationary_bootstrap_indices(n, block, bootstrap.seeded_random(seed)),
    "bootstrap.stationaryBootstrap.sharpe": lambda series: bootstrap.stationary_bootstrap(
        series, {"sharpe": lambda s: metrics.sharpe_ratio(s, 0.03), "dd": metrics.max_drawdown_from_returns}
    ),
    "bootstrap.clusterBootstrap.mean": lambda clusters: bootstrap.cluster_bootstrap(clusters, _mean),
    "bootstrap.quantile": bootstrap.quantile,
}


def test_bootstrap_statistics_receive_arrays() -> None:
    from app.research.agents.monthly import mean

    series = [0.01 * ((i * 7919) % 13 - 6) for i in range(80)]
    interval = bootstrap.stationary_bootstrap(series, {"mean": mean, "sharpe": lambda s: metrics.sharpe_ratio(s, 0.03)}, block_length=3)
    assert interval["mean"] is not None and interval["sharpe"] is not None


def test_risk_and_bootstrap_match_typescript() -> None:
    # The seeded PRNG and everything drawn from it must match bit for bit.
    check_module("risk", REGISTRY, rel=1e-12)
