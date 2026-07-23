"""
The net-worth dashboard: every product's balance converted into a
target currency (defaults to USD, but the frontend lets you pick any
currency you actually use) using rates fetched automatically (see
services/fx.py). Credit cards/loans/mortgages count as liabilities
(subtracted); debit cards/additional credit cards are excluded (their
value already lives in the linked product).

Also exposes /history (net worth over time, see services/history.py)
and /categories (spending-by-category breakdown, see
services/categories.py), both of which accept an optional
start_date/end_date window.
"""
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from services import balance as balance_service
from services import fx
from services import history as history_service
from services import categories as categories_service
from services import ticker as ticker_service

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=schemas.DashboardOut)
def get_dashboard(currency: str = "USD", db: Session = Depends(get_db)):
    target_currency = currency.strip().upper()
    fx.ensure_fresh_cache(db)
    rates = fx.get_cached_rates(db)

    products = db.query(models.Product).all()
    banks_by_id = {b.id: b.name for b in db.query(models.Bank).all()}
    available_currencies = sorted({p.currency for p in products} | {"USD"})

    result = balance_service.compute_totals(products, target_currency, rates)

    summaries = [
        schemas.ProductSummary(
            id=item["product"].id,
            bank_name=banks_by_id.get(item["product"].bank_id, "Unknown"),
            nickname=item["product"].nickname,
            type=item["product"].type,
            currency=item["product"].currency,
            display_balance=item["display_balance"],
            converted_value=item["converted_value"],
        )
        for item in result["items"]
    ]

    return schemas.DashboardOut(
        currency=target_currency,
        total_assets=result["total_assets"],
        total_liabilities=result["total_liabilities"],
        net_worth=result["net_worth"],
        missing_rates=result["missing_rates"],
        available_currencies=available_currencies,
        products=summaries,
    )


@router.get("/history", response_model=schemas.NetWorthHistoryOut)
def get_net_worth_history(
    currency: str = "USD",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
):
    target_currency = currency.strip().upper()
    fx.ensure_fresh_cache(db)
    rates = fx.get_cached_rates(db)
    points = history_service.compute_history(db, target_currency, rates, start_date, end_date)
    return schemas.NetWorthHistoryOut(
        currency=target_currency,
        points=[schemas.NetWorthPoint(**p) for p in points],
    )


@router.get("/categories", response_model=schemas.CategoryBreakdownOut)
def get_category_breakdown(
    currency: str = "USD",
    start_date: date | None = None,
    end_date: date | None = None,
    direction: str = "outflow",
    db: Session = Depends(get_db),
):
    target_currency = currency.strip().upper()
    fx.ensure_fresh_cache(db)
    rates = fx.get_cached_rates(db)
    result = categories_service.compute_breakdown(db, target_currency, rates, start_date, end_date, direction)
    return schemas.CategoryBreakdownOut(
        currency=target_currency,
        items=[schemas.CategoryAmount(**i) for i in result["items"]],
        missing_rates=result["missing_rates"],
    )


@router.get("/ticker", response_model=schemas.TickerOut)
def get_ticker(db: Session = Depends(get_db)):
    items = ticker_service.compute_ticker(db)
    return schemas.TickerOut(items=[schemas.TickerItem(**i) for i in items])
