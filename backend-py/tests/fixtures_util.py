"""Loads golden cases the Node API's pure functions produced before its removal, and compares results with a tolerance."""

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures"


def decode(value: Any) -> Any:
    if isinstance(value, dict):
        if "$num" in value:
            return {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}[value["$num"]]
        if "$date" in value:
            return datetime.fromisoformat(value["$date"].replace("Z", "+00:00")).replace(tzinfo=None)
        if "$map" in value:
            return {decode(k): decode(v) for k, v in value["$map"]}
        return {key: decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode(item) for item in value]
    return value


def load(module: str) -> list[dict[str, Any]]:
    return [decode(case) for case in json.loads((FIXTURES / f"{module}.json").read_text())]


def normalise(value: Any) -> Any:
    """Python results as the TS side would have encoded them (tuples as lists, dataclasses as dicts)."""
    if hasattr(value, "__dataclass_fields__"):
        return {key: normalise(getattr(value, key)) for key in value.__dataclass_fields__}
    if isinstance(value, dict):
        return {key: normalise(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalise(item) for item in value]
    return value


def mismatches(expected: Any, actual: Any, rel: float, where: str = "$") -> list[str]:
    actual = normalise(actual)
    if isinstance(expected, dict) and isinstance(actual, dict):
        out: list[str] = []
        for key in set(expected) | set(actual):
            if key not in expected or key not in actual:
                out.append(f"{where}.{key}: missing on one side")
                continue
            out += mismatches(expected[key], actual[key], rel, f"{where}.{key}")
        return out
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return [f"{where}: length {len(expected)} != {len(actual)}"]
        out = []
        for i, (a, b) in enumerate(zip(expected, actual, strict=True)):
            out += mismatches(a, b, rel, f"{where}[{i}]")
        return out
    if isinstance(expected, bool) or isinstance(actual, bool):
        return [] if expected == actual else [f"{where}: {expected!r} != {actual!r}"]
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if math.isnan(expected) and math.isnan(actual):
            return []
        if math.isclose(expected, actual, rel_tol=rel, abs_tol=rel * 1e-3):
            return []
        return [f"{where}: {expected!r} != {actual!r}"]
    return [] if expected == actual else [f"{where}: {expected!r} != {actual!r}"]


def check_module(module: str, registry: dict[str, Any], rel: float = 1e-9, loose: dict[str, float] | None = None) -> None:
    cases = load(module)
    missing = sorted({case["fn"] for case in cases} - set(registry))
    assert not missing, f"no Python port registered for {missing}"
    failures: list[str] = []
    for index, case in enumerate(cases):
        tolerance = (loose or {}).get(case["fn"], rel)
        result = registry[case["fn"]](*case["args"])
        problems = mismatches(case["result"], result, tolerance)
        failures += [f"{case['fn']} #{index} {problem}" for problem in problems[:3]]
    assert not failures, "\n".join(failures[:30])
