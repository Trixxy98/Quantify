from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Fold:
    train_start: int
    train_end: int
    test_start: int
    test_end: int


def walk_forward_folds(n: int, train: int, test: int, step: int) -> list[Fold]:
    """
    Rolling train window, then a test window that starts where training ends.
    The last fold is dropped when the remaining observations cannot fill a
    whole test window.
    """
    if train < 1 or test < 1 or step < 1:
        raise ValueError("walk-forward windows must be positive")
    folds = []
    start = 0
    while start + train + test <= n:
        folds.append(Fold(start, start + train, start + train, start + train + test))
        start += step
    return folds


def expanding_folds(n: int, min_train: int, step: int) -> list[Fold]:
    """
    Expanding train window from 0, refit every `step` observations. The last
    fold is kept even when short, so the newest observations are always
    forecast by the newest fit.
    """
    if min_train < 1 or step < 1:
        raise ValueError("walk-forward windows must be positive")
    folds = []
    train_end = min_train
    while train_end < n:
        folds.append(Fold(0, train_end, train_end, min(train_end + step, n)))
        train_end += step
    return folds


def walk_forward(
    n: int,
    train: int,
    test: int,
    step: int,
    fit: Callable[[int, int], Any],
    apply: Callable[[Any, int, int], list[float]],
) -> tuple[list[float], list[tuple[Fold, Any]]]:
    """`fit` sees only [train_start, train_end); `apply` sees only the test window and returns one value per observation."""
    returns: list[float] = []
    detailed: list[tuple[Fold, Any]] = []
    for fold in walk_forward_folds(n, train, test, step):
        params = fit(fold.train_start, fold.train_end)
        out = apply(params, fold.test_start, fold.test_end)
        if len(out) != fold.test_end - fold.test_start:
            raise ValueError("walk-forward apply must return one value per test observation")
        returns.extend(out)
        detailed.append((fold, params))
    return returns, detailed
