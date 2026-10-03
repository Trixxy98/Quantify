from app.services import black_scholes as bs
from app.services import event_study, implied_snapshot, variance_premium
from tests.fixtures_util import check_module

REGISTRY = {
    "bs.normCdf": bs.norm_cdf,
    "bs.normPdf": bs.norm_pdf,
    "bs.blackScholesPrice": bs.black_scholes_price,
    "bs.blackScholesVega": bs.black_scholes_vega,
    "bs.impliedVol": bs.implied_vol,
    "iv.atmStraddle": implied_snapshot.atm_straddle,
    "iv.frontMonthExpiry": implied_snapshot.front_month_expiry,
    "iv.ivRank": implied_snapshot.iv_rank,
    "vp.median": variance_premium.median,
    "vp.percentileRank": variance_premium.percentile_rank,
    "vp.eventSessionMove": variance_premium.event_session_move,
    "vp.expiryCovering": variance_premium.expiry_covering,
    "vp.expiryBefore": variance_premium.expiry_before,
    "vp.eventVariance": variance_premium.event_variance,
    "vp.impliedFromStraddle": variance_premium.implied_from_straddle,
    "es.finalCarInterval": event_study.final_car_interval,
}


def test_options_and_events_match_typescript() -> None:
    # Implied vols solved by a different root finder agree to the 1e-6 price tolerance both use.
    check_module("options", REGISTRY, rel=1e-9, loose={"bs.impliedVol": 1e-5})
