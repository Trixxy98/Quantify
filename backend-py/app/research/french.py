import re
from typing import TypedDict

# Regressors, in the order the regression reports them. RF is stored but is not a regressor.
FACTOR_NAMES = ("Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom")

FF5_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
MOMENTUM_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_daily_CSV.zip"
_DAY = re.compile(r"^\d{8}")


class FrenchRow(TypedDict):
    date: str
    values: dict[str, float]


def _number(text: str) -> float | None:
    """JavaScript Number(): blank is 0, anything unparsable is NaN (skipped)."""
    if text == "":
        return 0.0
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value == value and abs(value) != float("inf") else None


def parse_french_daily(csv: str) -> list[FrenchRow]:
    """
    Ken French daily files lead with a citation, then a header row whose first
    cell is empty, then YYYYMMDD rows in percent. A blank line starts the
    annual table, which is ignored. Values come back as fractions.
    """
    headers: list[str] | None = None
    rows: list[FrenchRow] = []
    for line in re.split(r"\r?\n", csv):
        trimmed = line.strip()
        if headers is None:
            if trimmed.startswith(",") and ("Mkt-RF" in trimmed or "Mom" in trimmed):
                headers = [cell.strip() for cell in trimmed.split(",")]
            continue
        if not trimmed or not _DAY.match(trimmed):
            break
        cells = [cell.strip() for cell in trimmed.split(",")]
        values: dict[str, float] = {}
        for i in range(1, len(headers)):
            name = headers[i]
            if not name:
                continue
            parsed = _number(cells[i]) if i < len(cells) else None
            if parsed is None:
                continue
            values[name] = parsed / 100
        stamp = cells[0]
        rows.append({"date": f"{stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]}", "values": values})
    return rows
