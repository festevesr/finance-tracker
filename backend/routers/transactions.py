"""
Everything related to managing transactions lives here, including the
inflow/outflow -> balance update logic (delegated to services/balance.py)
and currency conversion when a transaction's currency differs from its
product's currency.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from services import balance as balance_service
from services import transfers as transfers_service

router = APIRouter(prefix="/api/products/{product_id}/transactions", tags=["transactions"])
delete_router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _get_product_or_404(product_id: int, db: Session) -> models.Product:
    product = db.query(models.Product).get(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    return product


@router.get("", response_model=list[schemas.TransactionOut])
def list_transactions(product_id: int, db: Session = Depends(get_db)):
    _get_product_or_404(product_id, db)
    return (
        db.query(models.Transaction)
        .filter(models.Transaction.product_id == product_id)
        .order_by(models.Transaction.date.desc(), models.Transaction.id.desc())
        .all()
    )


@router.post("", response_model=schemas.TransactionOut, status_code=201)
def create_transaction(product_id: int, payload: schemas.TransactionCreate, db: Session = Depends(get_db)):
    product = _get_product_or_404(product_id, db)

    if payload.direction not in models.TRANSACTION_DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {models.TRANSACTION_DIRECTIONS}")

    # The product whose currency we convert into is the balance owner
    # (for a debit card, that's its linked savings account).
    owner = balance_service.get_balance_owner(product)

    try:
        converted_amount = balance_service.compute_converted_amount(
            amount=payload.amount,
            tx_currency=payload.currency,
            product_currency=owner.currency,
            exchange_rate=payload.exchange_rate,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    transaction = models.Transaction(
        product_id=product_id,
        date=payload.date,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        direction=payload.direction,
        amount=payload.amount,
        currency=payload.currency,
        exchange_rate=payload.exchange_rate,
        converted_amount=converted_amount,
    )
    db.add(transaction)
    balance_service.apply_transaction(db, product, converted_amount, payload.direction)
    db.commit()
    db.refresh(transaction)
    return transaction


@delete_router.put("/{transaction_id}", response_model=schemas.TransactionOut)
def update_transaction(transaction_id: int, payload: schemas.TransactionUpdate, db: Session = Depends(get_db)):
    transaction = db.query(models.Transaction).get(transaction_id)
    if not transaction:
        raise HTTPException(404, "Transaction not found")

    if transaction.is_transfer:
        raise HTTPException(
            400,
            "Transfers can't be edited since they move money on both sides at once — delete it and create a new transfer instead.",
        )

    product = db.query(models.Product).get(transaction.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    # Undo this transaction's old effect on the balance before recomputing
    # anything below — otherwise editing the amount would double-count.
    balance_service.reverse_transaction(db, product, transaction.converted_amount, transaction.direction)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(transaction, field, value)

    if transaction.direction not in models.TRANSACTION_DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {models.TRANSACTION_DIRECTIONS}")

    owner = balance_service.get_balance_owner(product)
    try:
        converted_amount = balance_service.compute_converted_amount(
            amount=transaction.amount,
            tx_currency=transaction.currency,
            product_currency=owner.currency,
            exchange_rate=transaction.exchange_rate,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))

    transaction.converted_amount = converted_amount
    balance_service.apply_transaction(db, product, converted_amount, transaction.direction)

    db.commit()
    db.refresh(transaction)
    return transaction


@delete_router.delete("/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.query(models.Transaction).get(transaction_id)
    if not transaction:
        raise HTTPException(404, "Transaction not found")

    if transaction.is_transfer:
        transfers_service.delete_transfer_pair(db, transaction)
        return

    product = db.query(models.Product).get(transaction.product_id)
    if product:
        balance_service.reverse_transaction(
            db, product, transaction.converted_amount, transaction.direction
        )

    db.delete(transaction)
    db.commit()
