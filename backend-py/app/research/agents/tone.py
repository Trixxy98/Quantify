"""Headline tone. A short finance word list, not the Loughran–McDonald dictionary."""

import re

# Whole words only. Kept small and original so the score is readable and the dictionary is ours.
POSITIVE = frozenset(
    {
        "beat",
        "beats",
        "growth",
        "profit",
        "profits",
        "record",
        "surge",
        "upgrade",
        "upgraded",
        "strong",
        "gain",
        "gains",
    }
)
NEGATIVE = frozenset(
    {
        "miss",
        "misses",
        "loss",
        "losses",
        "fraud",
        "downgrade",
        "downgraded",
        "weak",
        "decline",
        "cut",
        "cuts",
        "lawsuit",
    }
)
_WORDS = re.compile(r"[a-z]+")


def net_tone(titles: list[str]) -> float | None:
    """(positive − negative) / (positive + negative). None when no listed word appears."""
    positive = 0
    negative = 0
    for title in titles:
        for word in _WORDS.findall(title.lower()):
            if word in POSITIVE:
                positive += 1
            elif word in NEGATIVE:
                negative += 1
    total = positive + negative
    if total == 0:
        return None
    return (positive - negative) / total
