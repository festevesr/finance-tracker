"""
Core financial logic, kept separate from the API routers so it can be
tested/changed independently.

If you want to change WHICH product types count as liabilities (i.e.
subtract from net worth instead of adding to it), edit LIABILITY_TYPES
below. That's the only place this rule lives.
"""
from sqlalchemy.orm import Session

import models


# Product types whose balance should be treated as money you owe
# (subtracted from net worth) rather than money you have (added).
LIABILITY_TYPES = {"credit_card", "loan", "mortgage"}

# Product types whose transactions/balance are mirrored onto another
# product (via linked_product_id) rather than tracked independently.
LINKED_PRODUCT_TYPES = models.LINKED_PRODUCT_TYPES

# debit_card and additional_credit_card never hold their own
# balance/value, so they're excluded entirely from net worth sums (their
# value already lives in the linked product and would otherwise be
# double-counted).
EXCLUDED_FROM_NET_WORTH = LINKED_PRODUCT_TYPES


def get_balance_owner(product: models.Product) -> models.Product:
    """
    Returns the product whose `balance` column should actually be
    mutated/read for this product. For a debit card, that's the linked
    savings account. For an additional credit card, that's the primary
    credit card. For everything else, it's the product itself.
    """
    if product.type in LINKED_PRODUCT_TYPES and product.linked_product is not None:
        return product.linked_product
    return product


def get_display_balance(product: models.Product) -> float:
    if product.type == "additional_credit_card":
        return get_own_activity_balance(product)
    owner = get_balance_owner(product)
    return owner.balance or 0.0


def get_own_activity_balance(product: models.Product) -> float:
    """
    Sums this product's OWN transactions only — not anything that
    landed on a linked product — using the same liability sign
    convention as apply_transaction. Used for additional_credit_card:
    its transactions still consume the primary card's balance/credit
    line (that accounting is unchanged), but the card itself should
    display only what was actually charged on it specifically.
    """
    is_liability = product.type in LIABILITY_TYPES or product.type == "additional_credit_card"
    total = 0.0
    for tx in product.transactions:
        total += _signed_delta(tx.direction, tx.converted_amount, is_liability)
    return total


def _signed_delta(direction: str, amount: float, is_liability: bool) -> float:
    """
    Asset accounts (savings, time deposits, investments...): inflow
    increases the balance, outflow decreases it — balance means "how
    much you have."

    Liability accounts (credit cards, loans, mortgages): balance always
    means "how much you owe" as a positive number, so the sign is
    flipped — a charge (outflow) increases it, a payment (inflow)
    decreases it.
    """
    base = amount if direction == "inflow" else -amount
    return -base if is_liability else base


def apply_transaction(db: Session, product: models.Product, converted_amount: float, direction: str) -> None:
    """Applies a (already currency-converted) transaction amount to the
    correct balance owner."""
    owner = get_balance_owner(product)
    delta = _signed_delta(direction, converted_amount, owner.type in LIABILITY_TYPES)
    owner.balance = (owner.balance or 0.0) + delta
    db.add(owner)


def reverse_transaction(db: Session, product: models.Product, converted_amount: float, direction: str) -> None:
    """Undoes apply_transaction, used when deleting a transaction."""
    owner = get_balance_owner(product)
    delta = _signed_delta(direction, converted_amount, owner.type in LIABILITY_TYPES)
    owner.balance = (owner.balance or 0.0) - delta
    db.add(owner)


def compute_converted_amount(amount: float, tx_currency: str, product_currency: str, exchange_rate: float | None) -> float:
    """
    Converts a transaction amount into the product's own currency.
    `exchange_rate` means: 1 unit of tx_currency = exchange_rate units
    of product_currency.
    """
    if tx_currency == product_currency:
        return amount
    if exchange_rate is None:
        raise ValueError(
            f"exchange_rate is required when transaction currency "
            f"({tx_currency}) differs from product currency ({product_currency})"
        )
    return amount * exchange_rate


def convert_value(amount: float, from_currency: str, to_currency: str, rates: dict[str, float]) -> float | None:
    """
    Converts `amount` from `from_currency` to `to_currency` using a
    currency -> USD rate table (1 unit of currency = rates[currency]
    USD). Returns None if a rate is missing for either currency (USD
    itself never needs a rate). Same-currency conversions never need a
    rate at all.
    """
    if from_currency == to_currency:
        return amount

    def rate_to_usd(code: str) -> float | None:
        return 1.0 if code == "USD" else rates.get(code)

    from_rate = rate_to_usd(from_currency)
    to_rate = rate_to_usd(to_currency)
    if from_rate is None or to_rate is None:
        return None
    return amount * from_rate / to_rate


def signed_converted_value(product: models.Product, to_currency: str, rates: dict[str, float]) -> float | None:
    """Value of a product's balance in `to_currency`, negative if it's a liability."""
    if product.type in EXCLUDED_FROM_NET_WORTH:
        return None
    balance = get_display_balance(product)
    value = convert_value(balance, product.currency, to_currency, rates)
    if value is None:
        return None
    return -value if product.type in LIABILITY_TYPES else value


def compute_totals(products: list, target_currency: str, rates: dict[str, float]) -> dict:
    """
    Shared by the global dashboard and the per-bank totals endpoint:
    converts every (non-excluded) product's balance into target_currency
    and splits the result into assets/liabilities/net worth, plus a
    per-product breakdown. Both callers get this exact same logic so
    there's only one place that can get it wrong.
    """
    total_assets = 0.0
    total_liabilities = 0.0
    missing_rates = set()
    items = []

    for p in products:
        if p.type in EXCLUDED_FROM_NET_WORTH:
            continue

        display_balance = get_display_balance(p)
        signed_value = signed_converted_value(p, target_currency, rates)

        if signed_value is None:
            missing_rates.add(p.currency)
        elif p.type in LIABILITY_TYPES:
            total_liabilities += -signed_value  # store as positive magnitude
        else:
            total_assets += signed_value

        items.append({
            "product": p,
            "display_balance": display_balance,
            "converted_value": signed_value,
        })

    return {
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "net_worth": round(total_assets - total_liabilities, 2),
        "missing_rates": sorted(missing_rates),
        "items": items,
    }
