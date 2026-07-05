"""
SQLAlchemy models.

If you need to add a new field to a bank, product or transaction, this
is the only file you need to edit (plus a matching field in schemas.py
if it should be exposed through the API).

Note: timestamps use datetime.now() (local system time), not utcnow().
This app runs entirely on the user's own machine, so "now" should match
what their own clock says — not UTC, which can be a different calendar
day depending on the timezone (e.g. Peru is UTC-5).
"""
from datetime import datetime, date

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey
)
from sqlalchemy.orm import relationship

from database import Base


# Product types supported in MVP 1. Keeping this as a plain tuple (not an
# Enum) makes it trivial to add a new product type later: just add the
# string here and, if it needs special balance/liability behavior, update
# services/balance.py.
PRODUCT_TYPES = (
    "savings_account",
    "debit_card",
    "credit_card",
    "additional_credit_card",
    "loan",
    "mortgage",
    "time_deposit",
    "mutual_fund",
    "investment",
)

# Product types whose transactions/balance are mirrored onto another
# product (via linked_product_id) rather than tracked independently.
# debit_card -> its savings_account; additional_credit_card -> its
# primary credit_card.
LINKED_PRODUCT_TYPES = {"debit_card", "additional_credit_card"}

TRANSACTION_DIRECTIONS = ("inflow", "outflow")


class Bank(Base):
    __tablename__ = "banks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    products = relationship(
        "Product", back_populates="bank", cascade="all, delete-orphan"
    )


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    bank_id = Column(Integer, ForeignKey("banks.id"), nullable=False)

    type = Column(String, nullable=False)  # one of PRODUCT_TYPES
    nickname = Column(String, nullable=False)
    currency = Column(String, nullable=False)  # e.g. "USD", "PEN"

    # Balance is meaningless for debit cards (they mirror the linked
    # savings account instead) but used by every other product type.
    balance = Column(Float, nullable=True, default=0.0)

    # Only used by savings_account.
    account_number = Column(String, nullable=True)

    # Only used by debit_card / credit_card / additional_credit_card.
    expiry_date = Column(Date, nullable=True)

    # credit_card: the overall credit line for that account.
    # additional_credit_card: the sub-limit assigned to that cardholder
    # (still drawn from the primary card's overall line).
    credit_line = Column(Float, nullable=True)

    # Annual interest rate, as a percentage (e.g. 3.5 means 3.5%/year).
    # Informational only — purely for reference, never used in balance
    # math. Most relevant for savings_account and time_deposit, but
    # available on any product type since the field is optional.
    interest_rate = Column(Float, nullable=True)

    # debit_card -> points at the savings_account it draws from.
    # additional_credit_card -> points at the primary credit_card whose
    # balance/line it shares.
    linked_product_id = Column(Integer, ForeignKey("products.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.now)

    bank = relationship("Bank", back_populates="products")
    transactions = relationship(
        "Transaction", back_populates="product", cascade="all, delete-orphan",
        foreign_keys="Transaction.product_id",
    )
    templates = relationship("TransactionTemplate", cascade="all, delete-orphan")
    linked_product = relationship("Product", remote_side=[id])


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    date = Column(Date, nullable=False, default=date.today)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)

    direction = Column(String, nullable=False)  # "inflow" | "outflow"
    amount = Column(Float, nullable=False)  # in the transaction's own currency
    currency = Column(String, nullable=False)
    category = Column(String, nullable=True)  # free text; common ones suggested in the UI

    # Only set when transaction currency != product currency.
    exchange_rate = Column(Float, nullable=True)
    # amount converted into the product's currency (= amount if same currency)
    converted_amount = Column(Float, nullable=False)

    # True for both halves of a transfer between two of the user's own
    # products (e.g. paying a credit card from a savings account,
    # funding a time deposit, moving money between accounts). Transfers
    # still move real money exactly like any other transaction, but are
    # excluded from the spending-by-category breakdown since they're not
    # actual income or expense — see services/categories.py.
    is_transfer = Column(Boolean, nullable=False, default=False)
    # Points at the other half of the same transfer (the outflow on the
    # source product <-> the inflow on the destination product). Always
    # set together via /api/transfers; null for ordinary transactions.
    transfer_pair_id = Column(Integer, ForeignKey("transactions.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.now)

    product = relationship(
        "Product", back_populates="transactions", foreign_keys=[product_id]
    )


class TransactionTemplate(Base):
    """
    A saved "shape" of a transaction (everything except the date) that
    you can reuse with one click instead of retyping it — rent, salary,
    subscriptions, anything that repeats. No automatic scheduling: the
    user always picks when to use one, the app just pre-fills the form.
    """
    __tablename__ = "transaction_templates"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True)
    direction = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    exchange_rate = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.now)


class ExchangeRate(Base):
    """
    Currency -> USD rates, used only to compute the net-worth dashboard
    total in USD. Fetched and cached automatically from a public exchange
    rate API (see services/fx.py) — not user-entered. Not related to the
    per-transaction exchange rate above (which converts a transaction's
    currency into its product's currency).
    """
    __tablename__ = "exchange_rates"

    currency = Column(String, primary_key=True)  # e.g. "PEN"
    rate_to_usd = Column(Float, nullable=False)  # 1 unit of currency = X USD
    previous_rate_to_usd = Column(Float, nullable=True)  # value before the most recent refresh, for the ticker's up/down arrows
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class FxCacheMeta(Base):
    """
    Single-row table tracking when exchange_rates was last refreshed from
    the external API, so we don't hit it more than necessary (see
    services/fx.py for the refresh interval).
    """
    __tablename__ = "fx_cache_meta"

    id = Column(Integer, primary_key=True)
    last_fetched_at = Column(DateTime, nullable=True)
