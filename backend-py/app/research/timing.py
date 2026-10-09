"""Whether a fill beat the close, and the close 5 and 20 sessions later. Descriptive only."""

import statistics
from collections.abc import Sequence

HORIZONS = ("sameDay", "sessions5", "sessions20")
_OFFSET = {"sameDay": 0, "sessions5": 5, "sessions20": 20}
MIN_CLAIM = 30


def timing_bps(side: str, fill: float, close: float) -> float | None:
    """Signed move from the fill to `close`, in basis points.

    A later rise is a gain for a buy and a cost for a sell.
    """
    if fill <= 0 or close != close:
        return None
    move = (close / fill - 1) * 10_000
    return move if side == "BUY" else -move


def mark_fill(side: str, fill: float, trade_day: str, bars: Sequence[tuple[str, float]]) -> dict[str, float | None]:
    """`bars` are (YYYY-MM-DD, close), ascending. Sessions are counted after the trade date."""
    after = [close for day, close in bars if day > trade_day]
    on_day = next((close for day, close in bars if day == trade_day), None)
    marks: dict[str, float | None] = {}
    for name, offset in _OFFSET.items():
        close = on_day if offset == 0 else (after[offset - 1] if len(after) >= offset else None)
        marks[name] = None if close is None else timing_bps(side, fill, close)
    return marks


def summarize(fills: Sequence[tuple[str, dict[str, float | None]]]) -> dict[str, object]:
    """Mean and median bps by side and horizon. No significance language below 30 same-day fills."""
    rows = []
    same_day = 0
    for side in ("BUY", "SELL"):
        for horizon in HORIZONS:
            values = [value for fill_side, marks in fills if fill_side == side and (value := marks.get(horizon)) is not None]
            if horizon == "sameDay":
                same_day += len(values)
            rows.append(
                {
                    "side": side,
                    "horizon": horizon,
                    "n": len(values),
                    "meanBps": None if not values else statistics.fmean(values),
                    "medianBps": None if not values else statistics.median(values),
                }
            )
    note = "Descriptive only. No significance claim below 30 trades." if same_day < MIN_CLAIM else "Descriptive timing versus the close. Not a test of skill."
    return {"note": note, "rows": rows}
