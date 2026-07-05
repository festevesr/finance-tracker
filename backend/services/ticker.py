"""
Builds the data for the dashboard's ticker bar: a cross rate for both
directions of every distinct pair among the currencies the user's
products actually use (plus USD as a reference point, since it's
always available), with an up/down direction versus the previous
exchange-rate refresh.
"""
from itertools import permutations

import models
from services import fx


def _cross_rate(rates_with_previous: dict, a: str, b: str) -> tuple[float | None, float | None]:
    """Returns (current_cross_rate, previous_cross_rate) for 1 unit of
    `a` expressed in `b`. previous is None if either side has no
    previous value yet (e.g. right after the very first fetch ever)."""

    def usd_rate(code: str) -> tuple[float | None, float | None]:
        if code == "USD":
            return 1.0, 1.0
        return rates_with_previous.get(code, (None, None))

    a_now, a_prev = usd_rate(a)
    b_now, b_prev = usd_rate(b)

    if a_now is None or b_now is None:
        return None, None

    current = a_now / b_now
    previous = (a_prev / b_prev) if (a_prev is not None and b_prev is not None) else None
    return current, previous


def compute_ticker(db) -> list[dict]:
    fx.ensure_fresh_cache(db)
    rates_with_previous = fx.get_cached_rates_with_previous(db)

    product_currencies = {p.currency for p in db.query(models.Product).all()}
    currencies = sorted(product_currencies | {"USD"})

    items = []
    for a, b in permutations(currencies, 2):
        current, previous = _cross_rate(rates_with_previous, a, b)
        if current is None:
            continue

        change_pct = None
        direction = "flat"
        if previous is not None and previous != 0:
            change_pct = round((current - previous) / previous * 100, 3)
            if change_pct > 0.001:
                direction = "up"
            elif change_pct < -0.001:
                direction = "down"

        items.append({
            "base": a,
            "quote": b,
            "rate": round(current, 6),
            "change_pct": change_pct,
            "direction": direction,
        })

    return items
