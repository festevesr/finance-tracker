"""
Reconstructs net worth over time for the dashboard's line chart.

There's no stored history of balances — only the current balance plus
the full transaction log. So for each product we work backwards: its
current balance already has every transaction applied, so
  initial_balance = current_balance - sum(all deltas ever applied)
and then we replay deltas forward in date order to get the balance as
of any past date.

Caveat (documented for whoever edits this next): this uses TODAY's
exchange rates for every historical point, since we don't track
historical FX rates. It's an approximation, not a true historical
net-worth chart, but it's the best we can do without external
historical-rate data.
"""
from collections import defaultdict
from datetime import date as date_type, datetime

import models
from services import balance as balance_service


def _signed_delta_for_transaction(tx: models.Transaction, owner_is_liability: bool) -> float:
    base = tx.converted_amount if tx.direction == "inflow" else -tx.converted_amount
    return -base if owner_is_liability else base


def compute_history(
    db,
    target_currency: str,
    rates: dict[str, float],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
) -> list[dict]:
    """Returns a sorted list of {date, net_worth, incomplete} points,
    where date is a date object and net_worth is in `target_currency`.
    `incomplete` is True if at least one product couldn't be converted
    (missing exchange rate) for that date.

    If start_date/end_date are given, the full history is still
    reconstructed internally (so the math stays correct), but only
    points within [start_date, end_date] are returned — with a point
    AT start_date synthesized if no transaction happened exactly then,
    so a filtered chart doesn't misleadingly start from zero."""
    products = db.query(models.Product).filter(
        ~models.Product.type.in_(balance_service.EXCLUDED_FROM_NET_WORTH)
    ).all()

    if not products:
        return []

    # All transactions whose balance effect lands on each "owner" product
    # (a product's own transactions, plus any linked cards' transactions).
    deltas_by_owner_id: dict[int, list[tuple[date_type, float]]] = defaultdict(list)
    all_transactions = db.query(models.Transaction).all()
    products_by_id = {p.id: p for p in db.query(models.Product).all()}

    for tx in all_transactions:
        source_product = products_by_id.get(tx.product_id)
        if source_product is None:
            continue
        owner = balance_service.get_balance_owner(source_product)
        is_liability = owner.type in balance_service.LIABILITY_TYPES
        delta = _signed_delta_for_transaction(tx, is_liability)
        deltas_by_owner_id[owner.id].append((tx.date, delta))

    all_dates: set[date_type] = set()
    initial_balance_by_id: dict[int, float] = {}
    creation_date_by_id: dict[int, date_type] = {}

    for p in products:
        events = deltas_by_owner_id.get(p.id, [])
        total_delta = sum(d for _, d in events)
        initial_balance_by_id[p.id] = (p.balance or 0.0) - total_delta
        creation_date = (p.created_at or datetime.now()).date()
        if events:
            # A transaction dated before created_at means the product
            # clearly existed earlier in real life, even if it was only
            # added to the app today — don't zero it out for those dates.
            creation_date = min(creation_date, min(d for d, _ in events))
        creation_date_by_id[p.id] = creation_date
        all_dates.add(creation_date)
        for event_date, _ in events:
            all_dates.add(event_date)

    today = datetime.now().date()
    if start_date:
        all_dates.add(start_date)
    if end_date:
        all_dates.add(min(end_date, today))
    else:
        all_dates.add(today)
    sorted_dates = sorted(all_dates)

    # Pre-sort each product's events once, so we can sweep forward
    # cheaply instead of re-summing from scratch at every date.
    sorted_events_by_id = {
        p.id: sorted(deltas_by_owner_id.get(p.id, []), key=lambda pair: pair[0]) for p in products
    }
    cursor_by_id = {p.id: 0 for p in products}
    running_balance_by_id = {p.id: initial_balance_by_id[p.id] for p in products}

    points = []
    for current_date in sorted_dates:
        net_worth = 0.0
        any_missing_rate = False

        for p in products:
            if current_date < creation_date_by_id[p.id]:
                continue  # didn't exist yet

            events = sorted_events_by_id[p.id]
            cursor = cursor_by_id[p.id]
            while cursor < len(events) and events[cursor][0] <= current_date:
                running_balance_by_id[p.id] += events[cursor][1]
                cursor += 1
            cursor_by_id[p.id] = cursor

            balance_value = running_balance_by_id[p.id]
            converted = balance_service.convert_value(balance_value, p.currency, target_currency, rates)
            if converted is None:
                any_missing_rate = True
                continue
            net_worth += -converted if p.type in balance_service.LIABILITY_TYPES else converted

        points.append({"date": current_date, "net_worth": round(net_worth, 2), "incomplete": any_missing_rate})

    if start_date or end_date:
        points = [
            p for p in points
            if (start_date is None or p["date"] >= start_date) and (end_date is None or p["date"] <= end_date)
        ]

    return points
