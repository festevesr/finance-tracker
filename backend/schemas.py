"""
Pydantic schemas (request/response shapes for the API).

If the frontend needs a new field exposed or accepted, add/edit it here
to match models.py.
"""
from datetime import date as date_type, datetime
from typing import Optional

from pydantic import BaseModel, Field

from models import PRODUCT_TYPES, TRANSACTION_DIRECTIONS


# ---------- Bank ----------

class BankCreate(BaseModel):
    name: str


class BankUpdate(BaseModel):
    name: str


class BankOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# ---------- Product ----------

class ProductCreate(BaseModel):
    bank_id: int
    type: str = Field(description=f"One of: {', '.join(PRODUCT_TYPES)}")
    nickname: str
    currency: Optional[str] = Field(
        default=None,
        description="Required unless `type` is debit_card/additional_credit_card, which always mirror the linked product's currency.",
    )
    balance: Optional[float] = 0.0
    account_number: Optional[str] = None
    expiry_date: Optional[date_type] = None
    linked_product_id: Optional[int] = None
    credit_line: Optional[float] = None
    interest_rate: Optional[float] = Field(default=None, description="Annual rate as a percentage, e.g. 3.5 for 3.5%/year. Informational only.")


class ProductUpdate(BaseModel):
    nickname: Optional[str] = None
    currency: Optional[str] = None
    balance: Optional[float] = None
    account_number: Optional[str] = None
    expiry_date: Optional[date_type] = None
    linked_product_id: Optional[int] = None
    credit_line: Optional[float] = None
    interest_rate: Optional[float] = None


class ProductOut(BaseModel):
    id: int
    bank_id: int
    type: str
    nickname: str
    currency: str
    balance: Optional[float]
    account_number: Optional[str]
    expiry_date: Optional[date_type]
    linked_product_id: Optional[int]
    credit_line: Optional[float]
    interest_rate: Optional[float]
    # Computed: for debit cards / additional credit cards this is the
    # linked product's balance; for everything else it equals `balance`.
    # The frontend should display this field, not `balance`.
    display_balance: Optional[float] = None
    # Computed, credit_card/additional_credit_card only: the real total
    # currently owed across the primary card and all its additional
    # cards combined. For a primary card this equals display_balance;
    # for an additional card it's usually different from
    # display_balance, which shows only that card's own activity.
    shared_balance: Optional[float] = None

    class Config:
        from_attributes = True


# ---------- Transaction ----------

class TransactionCreate(BaseModel):
    date: date_type
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    direction: str = Field(description=f"One of: {', '.join(TRANSACTION_DIRECTIONS)}")
    amount: float
    currency: str
    exchange_rate: Optional[float] = Field(
        default=None,
        description=(
            "Required only if `currency` differs from the product's "
            "currency. 1 unit of transaction currency = X units of "
            "product currency."
        ),
    )


class TransactionUpdate(BaseModel):
    date: Optional[date_type] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    direction: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    exchange_rate: Optional[float] = None


class TransactionOut(BaseModel):
    id: int
    product_id: int
    date: date_type
    name: str
    description: Optional[str]
    category: Optional[str]
    direction: str
    amount: float
    currency: str
    exchange_rate: Optional[float]
    converted_amount: float
    is_transfer: bool
    transfer_pair_id: Optional[int]
    is_settlement: bool

    class Config:
        from_attributes = True


# ---------- Transfers (moving money between two of the user's own
# products — paying a card from savings, funding a time deposit, etc.) ----------

class TransferCreate(BaseModel):
    date: date_type
    source_product_id: int
    destination_product_id: int
    name: str = "Transfer"
    description: Optional[str] = None
    amount: float = Field(description="Amount leaving the source product, in the source product's own currency.")
    destination_exchange_rate: Optional[float] = Field(
        default=None,
        description=(
            "Required only if the source and destination products use "
            "different currencies. 1 unit of source currency = X units "
            "of destination currency."
        ),
    )


class TransferOut(BaseModel):
    source_transaction: TransactionOut
    destination_transaction: TransactionOut


class CycleSettleOut(BaseModel):
    """Returned by POST /api/products/{id}/settle-cycle — contains all
    the transactions created to zero out the card family's balances."""
    settled_transactions: list[TransactionOut]
    total_settled: float
    currency: str


# ---------- Transaction templates (quick-entry shortcuts) ----------

class TemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    direction: str = Field(description=f"One of: {', '.join(TRANSACTION_DIRECTIONS)}")
    amount: float
    currency: str
    exchange_rate: Optional[float] = None


class TemplateOut(BaseModel):
    id: int
    product_id: int
    name: str
    description: Optional[str]
    category: Optional[str]
    direction: str
    amount: float
    currency: str
    exchange_rate: Optional[float]

    class Config:
        from_attributes = True


# ---------- Exchange rates (auto-fetched, for USD dashboard) ----------

class ExchangeRateOut(BaseModel):
    currency: str
    rate_to_usd: float

    class Config:
        from_attributes = True


class ExchangeRatesStatusOut(BaseModel):
    last_fetched_at: Optional[datetime]
    fetch_succeeded: bool = True
    rates: list[ExchangeRateOut]


# ---------- Dashboard ----------

class ProductSummary(BaseModel):
    id: int
    bank_name: str
    nickname: str
    type: str
    currency: str
    display_balance: float
    converted_value: Optional[float]  # in the dashboard's target currency; None if no rate available


class DashboardOut(BaseModel):
    currency: str  # the target currency every total/converted_value below is expressed in
    total_assets: float
    total_liabilities: float
    net_worth: float
    missing_rates: list[str]  # currencies that couldn't be converted (no exchange rate available)
    available_currencies: list[str]  # USD + every currency used by any of your products
    products: list[ProductSummary]


class BankTotalsOut(BaseModel):
    currency: str
    total_assets: float
    total_liabilities: float
    net_worth: float
    missing_rates: list[str]
    available_currencies: list[str]


class NetWorthPoint(BaseModel):
    date: date_type
    net_worth: float
    incomplete: bool  # True if at least one product couldn't be converted for this point


class NetWorthHistoryOut(BaseModel):
    currency: str
    points: list[NetWorthPoint]


# ---------- Category breakdown (spending pie chart) ----------

class CategoryAmount(BaseModel):
    category: str  # "Uncategorized" if the transaction had no category
    amount: float  # total outflow in the breakdown's target currency


class CategoryBreakdownOut(BaseModel):
    currency: str
    items: list[CategoryAmount]
    missing_rates: list[str]


# ---------- Ticker bar (currency pairs among the user's product currencies) ----------

class TickerItem(BaseModel):
    base: str
    quote: str
    rate: float
    change_pct: Optional[float]  # percent change since the previous rate refresh; None if not yet known
    direction: str  # "up" | "down" | "flat"


class TickerOut(BaseModel):
    items: list[TickerItem]
