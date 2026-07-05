"""
Exchange rates are fetched automatically (see services/fx.py) — this
router just exposes the current cache for display, plus a manual
refresh button for the UI.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import schemas
from database import get_db
from services import fx

router = APIRouter(prefix="/api/exchange-rates", tags=["exchange-rates"])


def _status(db: Session, fetch_succeeded: bool = True) -> schemas.ExchangeRatesStatusOut:
    rates = fx.get_cached_rates(db)
    return schemas.ExchangeRatesStatusOut(
        last_fetched_at=fx.get_last_fetched_at(db),
        fetch_succeeded=fetch_succeeded,
        rates=[
            schemas.ExchangeRateOut(currency=c, rate_to_usd=r)
            for c, r in sorted(rates.items())
        ],
    )


@router.get("", response_model=schemas.ExchangeRatesStatusOut)
def get_rates(db: Session = Depends(get_db)):
    fx.ensure_fresh_cache(db)
    return _status(db)


@router.post("/refresh", response_model=schemas.ExchangeRatesStatusOut)
def refresh_rates(db: Session = Depends(get_db)):
    ok = fx.force_refresh(db)
    return _status(db, fetch_succeeded=ok)
