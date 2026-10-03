# Round-trip defaults for a liquid US name: commission plus half the spread, each way counted in the turnover.
DEFAULT_COMMISSION_BPS = 5
DEFAULT_SLIPPAGE_BPS = 5


def cost_drag(turnover: float, commission_bps: float = DEFAULT_COMMISSION_BPS, slippage_bps: float = DEFAULT_SLIPPAGE_BPS) -> float:
    """Fraction of portfolio value lost to trading; turnover 1 means the whole book changed hands."""
    return turnover * (commission_bps + slippage_bps) / 10_000


def apply_costs(
    gross: list[float], turnover: list[float], commission_bps: float = DEFAULT_COMMISSION_BPS, slippage_bps: float = DEFAULT_SLIPPAGE_BPS
) -> list[float]:
    return [ret - cost_drag(turnover[i] if i < len(turnover) else 0, commission_bps, slippage_bps) for i, ret in enumerate(gross)]
