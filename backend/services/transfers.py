"""
Transfers: moving money between two of the user's own products (paying
a credit card from a savings account, funding a time deposit, an
ordinary account-to-account transfer). A transfer is just two ordinary
transactions — an outflow on the source, an inflow on the destination —
created together and tagged is_transfer=True so they're excluded from
the spending-by-category breakdown (see services/categories.py). They
still move real balances exactly like any other transaction.

Editing a transfer isn't supported (the two-sided amount math makes a
partial edit ambiguous) — delete and recreate instead. Deleting either
side deletes and reverses both, via delete_transfer_pair below.
"""
from sqlalchemy.orm import Session
from fastapi import HTTPException

import models
from services import balance as balance_service


def create_transfer(db: Session, payload) -> tuple[models.Transaction, models.Transaction]:
    source = db.query(models.Product).get(payload.source_product_id)
    destination = db.query(models.Product).get(payload.destination_product_id)
    if not source:
        raise HTTPException(400, "source_product_id does not exist")
    if not destination:
        raise HTTPException(400, "destination_product_id does not exist")
    if source.id == destination.id:
        raise HTTPException(400, "source and destination must be different products")

    source_owner = balance_service.get_balance_owner(source)
    destination_owner = balance_service.get_balance_owner(destination)

    if destination_owner.currency != source_owner.currency:
        if payload.destination_exchange_rate is None:
            raise HTTPException(
                400,
                f"destination_exchange_rate is required: {source_owner.currency} -> {destination_owner.currency}",
            )
        destination_amount = payload.amount * payload.destination_exchange_rate
    else:
        destination_amount = payload.amount

    source_tx = models.Transaction(
        product_id=source.id,
        date=payload.date,
        name=payload.name,
        description=payload.description,
        category=None,
        direction="outflow",
        amount=payload.amount,
        currency=source_owner.currency,
        exchange_rate=None,
        converted_amount=payload.amount,
        is_transfer=True,
    )
    destination_tx = models.Transaction(
        product_id=destination.id,
        date=payload.date,
        name=payload.name,
        description=payload.description,
        category=None,
        direction="inflow",
        amount=destination_amount,
        currency=destination_owner.currency,
        exchange_rate=payload.destination_exchange_rate,
        converted_amount=destination_amount,
        is_transfer=True,
    )

    db.add(source_tx)
    db.add(destination_tx)
    balance_service.apply_transaction(db, source, payload.amount, "outflow")
    balance_service.apply_transaction(db, destination, destination_amount, "inflow")
    db.flush()  # need both ids before we can cross-link them

    source_tx.transfer_pair_id = destination_tx.id
    destination_tx.transfer_pair_id = source_tx.id

    db.commit()
    db.refresh(source_tx)
    db.refresh(destination_tx)
    return source_tx, destination_tx


def delete_transfer_pair(db: Session, transaction: models.Transaction) -> None:
    """Deletes `transaction` and, if it's part of a transfer, its
    paired transaction too — reversing both sides' balance effects."""
    pair = None
    if transaction.transfer_pair_id:
        pair = db.query(models.Transaction).get(transaction.transfer_pair_id)

    for tx in [transaction, pair]:
        if tx is None:
            continue
        product = db.query(models.Product).get(tx.product_id)
        if product:
            balance_service.reverse_transaction(db, product, tx.converted_amount, tx.direction)
        db.delete(tx)

    db.commit()
