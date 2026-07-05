"""
Spending-by-category breakdown for the net worth page's pie chart.
Only outflow transactions count as "spending" here; inflows (income,
transfers in, card payments) are intentionally excluded. Transfers
between the user's own products (is_transfer=True — paying a card from
savings, funding a time deposit, account-to-account moves) are also
excluded on either side, since they're not real spending or income.
"""
from collections import defaultdict
from datetime import date as date_type

import models
from services import balance as balance_service


def compute_breakdown(
    db,
    target_currency: str,
    rates: dict[str, float],
    start_date: date_type | None = None,
    end_date: date_type | None = None,
) -> dict:
    query = db.query(models.Transaction).filter(
        models.Transaction.direction == "outflow",
        models.Transaction.is_transfer == False,  # noqa: E712 (SQLAlchemy requires == here, not `is False`)
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
        # converted_amount is already in the product's own currency.
        converted = balance_service.convert_value(tx.converted_amount, product.currency, target_currency, rates)
        category = (tx.category or "").strip() or "Uncategorized"
        if converted is None:
            missing_rates.add(product.currency)
            continue
        totals[category] += converted

    items = [{"category": c, "amount": round(a, 2)} for c, a in totals.items()]
    items.sort(key=lambda item: -item["amount"])

    return {"items": items, "missing_rates": sorted(missing_rates)}
