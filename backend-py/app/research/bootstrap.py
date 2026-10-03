import math
from collections.abc import Callable, Mapping, Sequence
from typing import TypedDict

import numpy as np

BOOTSTRAP_RESAMPLES = 2000
BOOTSTRAP_BLOCK_LENGTH = 20
BOOTSTRAP_SEED = 1
# Below this many observations a 20-session block covers too much of the sample to mean anything.
BOOTSTRAP_MIN_OBSERVATIONS = 60
# Fewer clusters than this and the resamples are mostly repeats of the same few events.
BOOTSTRAP_MIN_CLUSTERS = 8

_MASK = 0xFFFFFFFF


class Interval(TypedDict):
    low: float  # 5th percentile
    high: float  # 95th percentile
    resamples: int
    method: str  # stationary | cluster
    blockLength: int | None


def _imul(a: int, b: int) -> int:
    """JavaScript Math.imul: 32-bit signed product, kept here as unsigned."""
    return (a * b) & _MASK


def seeded_random(seed: int) -> Callable[[], float]:
    """Mulberry32, bit for bit the TS version, so seeded intervals are identical on both backends."""
    state = seed & _MASK

    def next_value() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & _MASK
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296

    return next_value


def mulberry_block(seed: int, start: int, count: int) -> np.ndarray:
    """
    Outputs start..start+count of seeded_random(seed), vectorised. Mulberry32
    is counter-based: the k-th output depends only on seed + (k + 1)·C.
    """
    k = np.arange(start + 1, start + count + 1, dtype=np.uint64)
    state = ((np.uint64(seed & _MASK) + k * np.uint64(0x6D2B79F5)) & np.uint64(_MASK)).astype(np.uint32)
    t = (state ^ (state >> np.uint32(15))) * (state | np.uint32(1))
    t ^= t + (t ^ (t >> np.uint32(7))) * (t | np.uint32(61))
    return (t ^ (t >> np.uint32(14))).astype(np.float64) / 4294967296.0


class _Stream:
    """The seeded_random sequence as numpy blocks; `position` is the next unread output."""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self.position = 0

    def take(self, count: int) -> np.ndarray:
        return mulberry_block(self.seed, self.position, count)


def _stationary_indices_fast(n: int, expected_block: float, stream: _Stream) -> np.ndarray:
    """
    stationary_bootstrap_indices on a stream, without a Python loop. Each step
    reads one draw, plus a second when it restarts, so the read positions form
    a chain; pointer doubling finds all of them at once.
    """
    restart = 1 / expected_block
    window = stream.take(2 * n + 1)  # the most one resample can read
    first = int(np.floor(window[0] * n))
    if n == 1:
        stream.position += 1
        return np.array([first])
    restarts_at = window < restart
    jump = np.arange(len(window)) + 1 + restarts_at
    jump = np.minimum(jump, len(window) - 1)
    steps = np.arange(n - 1)  # step i reads at position[i]
    position = np.ones(n - 1, dtype=np.int64)
    table = jump
    bit = 0
    while (1 << bit) <= n - 2:
        mask = (steps >> bit) & 1 == 1
        position[mask] = table[position[mask]]
        table = table[table]
        bit += 1
    restarted = restarts_at[position]
    starts = np.floor(window[np.minimum(position + 1, len(window) - 1)] * n).astype(np.int64)
    # Segment s begins at step 0 (the first draw) or at a restart; indices then count up mod n.
    is_start = np.concatenate([[True], restarted])
    segment = np.cumsum(is_start) - 1
    begin_step = np.flatnonzero(is_start)
    begin_value = np.concatenate([[first], starts[restarted]])
    offsets = np.arange(n) - begin_step[segment]
    last = position[-1]
    stream.position += int(last + 1 + restarts_at[last])
    return (begin_value[segment] + offsets) % n


def stationary_bootstrap_indices(n: int, expected_block: float, random: Callable[[], float]) -> list[int]:
    """
    Politis–Romano (1994) stationary bootstrap: each step continues the block
    with probability 1 − 1/L or jumps to a uniform start. Indices wrap.
    """
    restart = 1 / expected_block
    indices = [0] * n
    current = math.floor(random() * n)
    for i in range(n):
        if i > 0:
            current = math.floor(random() * n) if random() < restart else (current + 1) % n
        indices[i] = current
    return indices


def quantile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile of an ascending-sorted list."""
    if len(sorted_values) == 0:
        return math.nan
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def _to_interval(draws: list[float], resamples: int, method: str, block_length: int | None) -> Interval | None:
    finite = sorted(value for value in draws if math.isfinite(value))
    if len(finite) < resamples / 2:
        return None
    return {"low": quantile(finite, 0.05), "high": quantile(finite, 0.95), "resamples": len(finite), "method": method, "blockLength": block_length}


def stationary_bootstrap(
    series: Sequence[float],
    statistics: Mapping[str, Callable[[list[float]], float]],
    resamples: int = BOOTSTRAP_RESAMPLES,
    block_length: int = BOOTSTRAP_BLOCK_LENGTH,
    seed: int = BOOTSTRAP_SEED,
) -> dict[str, Interval | None]:
    """5th–95th percentile intervals for several statistics of one series, all on the same resamples."""
    if len(series) < BOOTSTRAP_MIN_OBSERVATIONS:
        return {key: None for key in statistics}
    stream = _Stream(seed)
    values = np.asarray(series, dtype=float)
    draws: dict[str, list[float]] = {key: [] for key in statistics}
    n = len(series)
    for _ in range(resamples):
        sample = values[_stationary_indices_fast(n, block_length, stream)]
        for key, statistic in statistics.items():
            draws[key].append(statistic(sample))
    return {key: _to_interval(draws[key], resamples, "stationary", block_length) for key in statistics}


def cluster_bootstrap(
    clusters: Sequence[Sequence[float]],
    statistic: Callable[[list[float]], float],
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> Interval | None:
    """Resamples whole clusters (event dates) with replacement and applies `statistic` to the pooled values."""
    usable = [cluster for cluster in clusters if len(cluster) > 0]
    if len(usable) < BOOTSTRAP_MIN_CLUSTERS:
        return None
    random = seeded_random(seed)
    draws: list[float] = []
    for _ in range(resamples):
        pooled: list[float] = []
        for _ in range(len(usable)):
            pooled.extend(usable[math.floor(random() * len(usable))])
        draws.append(statistic(pooled))
    return _to_interval(draws, resamples, "cluster", None)
