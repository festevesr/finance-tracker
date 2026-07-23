"""
Category breakdown for the net worth page's chart.
Supports three views:
  - "outflow" (default): spending only — what you paid out
  - "inflow": income and incoming transfers — what came in
  - "net": outflow minus inflow per category (positive = net income for that category)

Transfers (is_transfer=True) and billing-cycle settlements (is_settlement=True)
are excluded from all views since they're not real income or expense.
"""
from collections import defaultdict
from datetime import date as date_type

import models
from services import balance as balance_service

VALID_DIRECTIONS = {"outflow", "inflow", "net"}


def compute_breakdown(
    db,
    target_currency: str,
    rates: dict[str, float],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
    direction: str = "outflow",
) -> dict:
    if direction not in VALID_DIRECTIONS:
        direction = "outflow"

    # Always exclude transfers and settlements — they're not real income/expense.
    base_filter = [
        models.Transaction.is_transfer == False,   # noqa: E712
        models.Transaction.is_settlement == False, # noqa: E712
    ]
    if direction == "net":
        query = db.query(models.Transaction).filter(*base_filter)
    else:
        query = db.query(models.Transaction).filter(
            *base_filter, models.Transaction.direction == direction
        )
    if start_date:
        query = query.filter(models.Transaction.date >= start_date)
    if end_date:
        query = query.filter(models.Transaction.date <= end_date)
    transactions = query.all()

    products_by_id = {p.id: p for p in db.query(models.Product).all()}

    totals: dict[str, float] = defaultdict(float)
    missing_rates: set[str] = set()

    for tx in transactions:
        product = products_by_id.get(tx.product_id)
        if product is None:
            continue
        converted = balance_service.convert_value(tx.converted_amount, product.currency, target_currency, rates)
        category = (tx.category or "").strip() or "Uncategorized"
        if converted is None:
            missing_rates.add(product.currency)
            continue
        # For "net", outflows reduce the total, inflows increase it.
        if direction == "net":
            totals[category] += converted if tx.direction == "inflow" else -converted
        else:
            totals[category] += converted

    items = [{"category": c, "amount": round(a, 2)} for c, a in totals.items()]
    # For net: sort by absolute value so large positive and negative both surface.
    items.sort(key=lambda item: -abs(item["amount"]))

    return {"items": items, "missing_rates": sorted(missing_rates)}
