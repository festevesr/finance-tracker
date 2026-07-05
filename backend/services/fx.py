"""
Automatic currency -> USD rates, fetched from a free public API and
cached in the database so we don't hit it on every request (and so the
app still works offline using the last known rates).

Provider: ExchangeRate-API's open access endpoint
(https://www.exchangerate-api.com/docs/free) — no API key required,
refreshes once a day, supports 165 currencies (including PEN). Their
terms require attribution, which is shown on the "Exchange rates" page
in the UI.

If you ever want to switch providers, this is the only file to touch —
everything else just calls get_cached_rates()/ensure_fresh_cache().
"""
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

import models

EXTERNAL_API_URL = "https://open.er-api.com/v6/latest/USD"

# The provider only updates once every 24h anyway, and asks API consumers
# not to poll more than necessary. Refreshing every 12h keeps us comfortably
# within that while still picking up the daily update reasonably quickly.
CACHE_TTL = timedelta(hours=12)

ATTRIBUTION_TEXT = "Rates by ExchangeRate-API"
ATTRIBUTION_URL = "https://www.exchangerate-api.com"

_META_ROW_ID = 1


def _fetch_and_store(db: Session) -> bool:
    """Fetches the full USD-based rate table and stores it inverted (so
    each row means '1 unit of CURRENCY = X USD'). Returns True on success,
    False if the request failed for any reason (e.g. no internet)."""
    try:
        response = httpx.get(EXTERNAL_API_URL, timeout=8)
        response.raise_for_status()
        payload = response.json()
        usd_to_currency = payload["rates"]  # 1 USD = usd_to_currency[code] units of code
    except Exception:
        return False

    now = datetime.now()
    for code, usd_to_code in usd_to_currency.items():
        if code == "USD" or not usd_to_code:
            continue
        rate_to_usd = 1 / usd_to_code
        row = db.query(models.ExchangeRate).get(code)
        if row:
            row.previous_rate_to_usd = row.rate_to_usd
            row.rate_to_usd = rate_to_usd
            row.updated_at = now
        else:
            db.add(models.ExchangeRate(currency=code, rate_to_usd=rate_to_usd, previous_rate_to_usd=None, updated_at=now))

    meta = db.query(models.FxCacheMeta).get(_META_ROW_ID)
    if meta:
        meta.last_fetched_at = now
    else:
        db.add(models.FxCacheMeta(id=_META_ROW_ID, last_fetched_at=now))

    db.commit()
    return True


def ensure_fresh_cache(db: Session) -> None:
    """Refreshes the cache only if it's missing or older than CACHE_TTL.
    Safe to call on every dashboard load — it's a no-op most of the time."""
    meta = db.query(models.FxCacheMeta).get(_META_ROW_ID)
    if meta and meta.last_fetched_at and (datetime.now() - meta.last_fetched_at) < CACHE_TTL:
        return
    _fetch_and_store(db)


def force_refresh(db: Session) -> bool:
    """Refreshes right now regardless of cache age. Used by the manual
    'Refresh now' button."""
    return _fetch_and_store(db)


def get_cached_rates(db: Session) -> dict[str, float]:
    return {r.currency: r.rate_to_usd for r in db.query(models.ExchangeRate).all()}


def get_cached_rates_with_previous(db: Session) -> dict[str, tuple[float, float | None]]:
    """Same as get_cached_rates, but each value is (current, previous)
    so callers can compute direction/percent change. previous is None
    on a currency's very first ever fetch."""
    return {r.currency: (r.rate_to_usd, r.previous_rate_to_usd) for r in db.query(models.ExchangeRate).all()}


def get_last_fetched_at(db: Session) -> datetime | None:
    meta = db.query(models.FxCacheMeta).get(_META_ROW_ID)
    return meta.last_fetched_at if meta else None
