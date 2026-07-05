"""Everything related to managing banks lives here."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from services import balance as balance_service
from services import fx

router = APIRouter(prefix="/api/banks", tags=["banks"])


@router.get("", response_model=list[schemas.BankOut])
def list_banks(db: Session = Depends(get_db)):
    return db.query(models.Bank).order_by(models.Bank.name).all()


@router.post("", response_model=schemas.BankOut, status_code=201)
def create_bank(payload: schemas.BankCreate, db: Session = Depends(get_db)):
    bank = models.Bank(name=payload.name)
    db.add(bank)
    db.commit()
    db.refresh(bank)
    return bank


@router.put("/{bank_id}", response_model=schemas.BankOut)
def update_bank(bank_id: int, payload: schemas.BankUpdate, db: Session = Depends(get_db)):
    bank = db.query(models.Bank).get(bank_id)
    if not bank:
        raise HTTPException(404, "Bank not found")
    bank.name = payload.name
    db.commit()
    db.refresh(bank)
    return bank


@router.delete("/{bank_id}", status_code=204)
def delete_bank(bank_id: int, db: Session = Depends(get_db)):
    bank = db.query(models.Bank).get(bank_id)
    if not bank:
        raise HTTPException(404, "Bank not found")
    db.delete(bank)  # cascades to products -> transactions
    db.commit()


@router.get("/{bank_id}/totals", response_model=schemas.BankTotalsOut)
def get_bank_totals(bank_id: int, currency: str = "USD", db: Session = Depends(get_db)):
    if not db.query(models.Bank).get(bank_id):
        raise HTTPException(404, "Bank not found")

    target_currency = currency.strip().upper()
    fx.ensure_fresh_cache(db)
    rates = fx.get_cached_rates(db)

    products = db.query(models.Product).filter(models.Product.bank_id == bank_id).all()
    available_currencies = sorted({p.currency for p in products} | {"USD"})

    result = balance_service.compute_totals(products, target_currency, rates)

    return schemas.BankTotalsOut(
        currency=target_currency,
        total_assets=result["total_assets"],
        total_liabilities=result["total_liabilities"],
        net_worth=result["net_worth"],
        missing_rates=result["missing_rates"],
        available_currencies=available_currencies,
    )
