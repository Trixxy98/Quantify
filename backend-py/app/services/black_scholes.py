"""European Black–Scholes. US listed equity options are American; this is the teaching approximation."""

import math
from typing import Literal, TypedDict

from scipy.optimize import brentq

OptionRight = Literal["call", "put"]
SQRT_2PI = math.sqrt(2 * math.pi)
VOL_LOW = 1e-4
VOL_HIGH = 5.0


def _erf(x: float) -> float:
    """Abramowitz–Stegun 7.1.26, kept from the Node API so prices and vols match to the last digit it printed."""
    sign = -1 if x < 0 else 1
    ax = abs(x)
    t = 1 / (1 + 0.3275911 * ax)
    y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-ax * ax)
    return sign * y


def norm_cdf(x: float) -> float:
    return 0.5 * (1 + _erf(x / math.sqrt(2)))


def norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_2PI


def black_scholes_price(spot: float, strike: float, time: float, rate: float, dividend: float, vol: float, right: OptionRight) -> float:
    if time <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        fwd = spot * math.exp((rate - dividend) * max(time, 0))
        disc = math.exp(-rate * max(time, 0))
        intrinsic = max(fwd - strike, 0) if right == "call" else max(strike - fwd, 0)
        return disc * intrinsic
    sqrt_t = math.sqrt(time)
    d1 = (math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * time) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    df_div = math.exp(-dividend * time)
    df_rate = math.exp(-rate * time)
    if right == "call":
        return spot * df_div * norm_cdf(d1) - strike * df_rate * norm_cdf(d2)
    return strike * df_rate * norm_cdf(-d2) - spot * df_div * norm_cdf(-d1)


def black_scholes_vega(spot: float, strike: float, time: float, rate: float, dividend: float, vol: float) -> float:
    if time <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        return 0.0
    sqrt_t = math.sqrt(time)
    d1 = (math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * time) / (vol * sqrt_t)
    return spot * math.exp(-dividend * time) * norm_pdf(d1) * sqrt_t


class IvSolve(TypedDict):
    iv: float
    method: Literal["newton", "bisection"]


def _intrinsic(spot: float, strike: float, time: float, rate: float, dividend: float, right: OptionRight) -> float:
    fwd = spot * math.exp(-dividend * time) - strike * math.exp(-rate * time)
    return max(fwd, 0) if right == "call" else max(-fwd, 0)


def _bracketed_iv(market: float, spot: float, strike: float, time: float, rate: float, dividend: float, right: OptionRight) -> float | None:
    """Fallback when Newton stalls: a bracketing root search between 0.01% and 500% vol."""
    low = black_scholes_price(spot, strike, time, rate, dividend, VOL_LOW, right)
    high = black_scholes_price(spot, strike, time, rate, dividend, VOL_HIGH, right)
    if market <= low or market >= high:
        return None
    return float(brentq(lambda vol: black_scholes_price(spot, strike, time, rate, dividend, vol, right) - market, VOL_LOW, VOL_HIGH, xtol=1e-10))


def implied_vol(market: float, spot: float, strike: float, time: float, rate: float, dividend: float, right: OptionRight) -> IvSolve | None:
    if not (market > 0) or not (spot > 0) or not (strike > 0) or not (time > 0):
        return None
    if market < _intrinsic(spot, strike, time, rate, dividend, right) - 1e-6:
        return None
    sigma = math.sqrt(2 * math.pi / time) * (market / spot)
    if not math.isfinite(sigma) or sigma < 0.05:
        sigma = 0.3
    sigma = min(max(sigma, 0.05), 2)
    for _ in range(40):
        price = black_scholes_price(spot, strike, time, rate, dividend, sigma, right)
        vega = black_scholes_vega(spot, strike, time, rate, dividend, sigma)
        diff = price - market
        if abs(diff) < 1e-6 and vega > 0:
            return {"iv": sigma, "method": "newton"}
        if vega < 1e-12:
            break
        sigma -= diff / vega
        if sigma <= VOL_LOW or sigma >= VOL_HIGH:
            break
    bracketed = _bracketed_iv(market, spot, strike, time, rate, dividend, right)
    if bracketed is None:
        return None
    return {"iv": bracketed, "method": "bisection"}
