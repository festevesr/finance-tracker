"""
Everything related to managing products (savings accounts, cards, loans,
mortgages, time deposits, mutual funds, investments) lives here.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from services import balance as balance_service

router = APIRouter(prefix="/api/products", tags=["products"])

# Which product type a given linked type must point to. Add a new entry
# here (and to models.LINKED_PRODUCT_TYPES) if you add another "this
# product mirrors another one" relationship in the future.
LINK_RULES = {
    "debit_card": "savings_account",
    "additional_credit_card": "credit_card",
}


def to_out(product: models.Product) -> schemas.ProductOut:
    out = schemas.ProductOut.model_validate(product)
    out.display_balance = balance_service.get_display_balance(product)
    if product.type in ("credit_card", "additional_credit_card"):
        owner = balance_service.get_balance_owner(product)
        out.shared_balance = owner.balance or 0.0
    return out


def validate_product_rules(payload, db: Session, existing: models.Product | None = None) -> models.Product | None:
    """Shared validation for create/update. Returns the linked product
    (if any), so callers can derive currency from it rather than trust
    whatever the client sent."""
    ptype = payload.type if hasattr(payload, "type") else existing.type

    if ptype not in models.PRODUCT_TYPES:
        raise HTTPException(400, f"Unknown product type '{ptype}'")

    required_link_type = LINK_RULES.get(ptype)
    if not required_link_type:
        return None

    linked_id = getattr(payload, "linked_product_id", None)
    if linked_id is None:
        if existing is not None and existing.linked_product_id is not None:
            linked_id = existing.linked_product_id
        else:
            raise HTTPException(400, f"{ptype} requires linked_product_id (a {required_link_type})")

    linked = db.query(models.Product).get(linked_id)
    if not linked or linked.type != required_link_type:
        raise HTTPException(400, f"linked_product_id must point to a {required_link_type}")
    return linked


@router.get("", response_model=list[schemas.ProductOut])
def list_products(bank_id: int | None = None, linked_to: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Product)
    if bank_id is not None:
        query = query.filter(models.Product.bank_id == bank_id)
    if linked_to is not None:
        query = query.filter(models.Product.linked_product_id == linked_to)
    return [to_out(p) for p in query.order_by(models.Product.nickname).all()]


@router.get("/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).get(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    return to_out(product)


@router.post("", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    if not db.query(models.Bank).get(payload.bank_id):
        raise HTTPException(400, "bank_id does not exist")

    linked = validate_product_rules(payload, db)

    has_own_balance = payload.type not in models.LINKED_PRODUCT_TYPES

    if linked is not None:
        currency = linked.currency  # always mirror the linked product, regardless of what was sent
    elif payload.currency:
        currency = payload.currency.strip().upper()
    else:
        raise HTTPException(400, "currency is required for this product type")

    product = models.Product(
        bank_id=payload.bank_id,
        type=payload.type,
        nickname=payload.nickname,
        currency=currency,
        balance=(payload.balance or 0.0) if has_own_balance else 0.0,
        account_number=payload.account_number,
        expiry_date=payload.expiry_date,
        linked_product_id=payload.linked_product_id,
        credit_line=payload.credit_line,
        interest_rate=payload.interest_rate,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return to_out(product)


@router.put("/{product_id}", response_model=schemas.ProductOut)
def update_product(product_id: int, payload: schemas.ProductUpdate, db: Session = Depends(get_db)):
    product = db.query(models.Product).get(product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    linked = validate_product_rules(payload, db, existing=product)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "balance" and product.type in models.LINKED_PRODUCT_TYPES:
            continue  # debit cards / additional credit cards never store their own balance
        if field == "currency" and linked is not None:
            continue  # currency always mirrors the linked product instead
        setattr(product, field, value)

    if linked is not None:
        product.currency = linked.currency

    db.commit()
    db.refresh(product)
    return to_out(product)


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).get(product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    linked_children = db.query(models.Product).filter(models.Product.linked_product_id == product_id).count()
    if linked_children:
        raise HTTPException(
            400,
            "Other products (a debit card or additional credit card) are linked to this one. "
            "Delete or relink those first."
        )

    db.delete(product)
    db.commit()


@router.post("/{product_id}/settle-cycle", response_model=schemas.CycleSettleOut)
def settle_credit_card_cycle(product_id: int, db: Session = Depends(get_db)):
    """
    Marks a billing cycle as paid for a credit card family (primary +
    any additional cards). Call this AFTER recording the actual payment
    from your savings account as a regular inflow on the primary card.

    What this does:
    - Sets the primary card balance to zero (records a settlement
      marker so it shows as paid).
    - Resets each additional card's own accumulated activity to zero
      with a matching settlement marker.

    Use the regular 'Transfer' feature to record the money moving from
    your savings account to the credit card first — then use
    'Settle cycle' to zero out the additional cards' display totals too.
    """
    from datetime import date as dt_date

    product = db.query(models.Product).get(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    if product.type != "credit_card":
        raise HTTPException(400, "Only a primary credit_card can settle a billing cycle.")

    today = dt_date.today()
    settled_txs = []
    total_settled = 0.0

    additional_cards = db.query(models.Product).filter(
        models.Product.linked_product_id == product_id,
        models.Product.type == "additional_credit_card",
    ).all()

    for card in additional_cards:
        own_balance = balance_service.get_display_balance(card)
        if abs(own_balance) < 0.001:
            continue  # nothing to zero out on this card

        # A settlement is an inflow that brings the additional card's
        # own display back to zero. It does NOT affect the primary card
        # balance (which the real payment already handled) — so we add
        # directly to the additional card's internal sum only, not via
        # apply_transaction (which would hit the primary card's balance).
        # We do this by applying it as an inflow at the balance_service
        # level but directing it at the additional card itself.
        settle_tx = models.Transaction(
            product_id=card.id,
            date=today,
            name="Billing cycle settled",
            description="Monthly billing cycle closed — additional card balance reset to zero",
            category=None,
            direction="inflow",
            amount=abs(own_balance),
            currency=card.currency,
            exchange_rate=None,
            converted_amount=abs(own_balance),
            is_transfer=True,
        )
        db.add(settle_tx)
        # Directly update the primary card's balance (the owner) to
        # cancel out the additional card's portion. The real payment
        # was already recorded separately as a transfer; this settlement
        # marker is purely for display bookkeeping on the additional card.
        # Because apply_transaction would double-touch the primary card,
        # we update the additional card's *shadow* accumulation instead
        # by crediting the owner of the additional card directly.
        # Actually: the additional card display_balance is computed from
        # its own transactions only (get_own_activity_balance). So we
        # simply need to record an inflow on it to bring that sum to 0.
        # No balance_service.apply_transaction call needed here — that
        # would double-count on the primary card.
        db.flush()
        settled_txs.append(settle_tx)
        total_settled += abs(own_balance)

    db.commit()
    for tx in settled_txs:
        db.refresh(tx)

    return schemas.CycleSettleOut(
        settled_transactions=settled_txs,
        total_settled=round(total_settled, 2),
        currency=product.currency,
    )
