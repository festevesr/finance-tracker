# Compass — Personal Finance Tracker

A local web app to track your banks, accounts, credit cards, loans, mortgages, time deposits, mutual funds and investments — with categories, transfers, a net-worth dashboard, history charts, and a spending-by-category breakdown.

Built with **FastAPI + SQLite** on the backend and plain **HTML/CSS/JavaScript** (no frameworks) on the frontend.

---

## Features

- **Multiple banks and products** — savings accounts, debit cards, credit cards, additional credit cards, loans, mortgages, time deposits, mutual funds, and investments
- **Transactions** — add, edit, duplicate; optional categories (or type your own); quick-entry templates for recurring payments
- **Transfers** — move money between your own products (pay a card from savings, fund a time deposit, etc.); automatically excluded from the spending breakdown
- **Credit card billing cycles** — primary + additional cards share a credit line; settle a billing cycle with one click to reset additional cards after payment
- **Dashboard** — net worth in any currency you use, a net-worth-over-time line chart, a spending-by-category donut chart, date-range filtering, and a scrolling currency-pair ticker
- **Multi-currency** — each product can use a different currency; exchange rates are fetched automatically
- **Searchable currency picker** — type a code or name (e.g. "sol" → PEN) to find any of 150+ currencies
- **Modular code** — one file per responsibility; easy to change one thing without touching anything else

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy, SQLite |
| Frontend | Plain HTML/CSS/ES Modules (no framework, no build step) |
| Exchange rates | [ExchangeRate-API](https://www.exchangerate-api.com) (free tier, auto-cached) |

---

## Setup

### Prerequisites

- Python 3.10 or later
- Git

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/compass.git
cd compass

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate         # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the server
cd backend
python -m uvicorn main:app --reload
```

Then open **http://127.0.0.1:8000** in your browser.

The SQLite database (`backend/finance.db`) is created automatically on first run and stays on your machine — it is listed in `.gitignore` and will never be committed.

---

## Project structure

```
compass/
├── backend/
│   ├── main.py                 # FastAPI app, router registration
│   ├── database.py             # DB engine (only file that knows about SQLite)
│   ├── models.py               # SQLAlchemy table definitions
│   ├── schemas.py              # Pydantic request/response shapes
│   ├── routers/
│   │   ├── banks.py            # bank CRUD + per-bank totals
│   │   ├── products.py         # product CRUD + billing cycle settlement
│   │   ├── transactions.py     # add / edit / delete transactions
│   │   ├── transfers.py        # linked transaction pairs (between own products)
│   │   ├── templates.py        # quick-entry recurring templates
│   │   ├── exchange_rates.py   # auto-fetched FX rate cache
│   │   └── dashboard.py        # totals, history, category breakdown, ticker
│   └── services/
│       ├── balance.py          # financial math: linked products, currency conversion, totals
│       ├── fx.py               # exchange rate fetching and caching
│       ├── history.py          # net worth history reconstruction from transactions
│       ├── categories.py       # spending-by-category aggregation
│       ├── transfers.py        # transfer creation and deletion logic
│       └── ticker.py           # currency-pair cross rates for the ticker bar
├── frontend/
│   ├── index.html
│   ├── css/styles.css          # all design tokens (colors, fonts) are CSS variables at the top
│   └── js/
│       ├── api.js              # all backend HTTP calls live here
│       ├── utils.js            # shared helpers, product type definitions
│       ├── currencies.js       # ISO 4217 currency list
│       ├── currency-select.js  # searchable typeahead currency picker
│       ├── networth-chart.js   # SVG line chart with hover tooltip
│       ├── category-chart.js   # SVG donut chart with hover tooltip
│       ├── ticker.js           # scrolling currency ticker bar
│       ├── banks.js            # sidebar + bank pages
│       ├── products.js         # product dialog + detail page
│       ├── transactions.js     # transaction dialog (add/edit/duplicate/template) + table
│       ├── transfer-dialog.js  # transfer dialog
│       ├── dashboard.js        # dashboard page
│       └── main.js             # view routing, wires everything together
└── requirements.txt
```

**Where to go for common changes:**

| What you want to change | File |
|---|---|
| Which product types count as liabilities | `backend/services/balance.py` → `LIABILITY_TYPES` |
| Add a new product type | `backend/models.py` + `frontend/js/utils.js` → `PRODUCT_TYPES` |
| Color palette / fonts | `frontend/css/styles.css` → CSS variables at the top |
| Suggested transaction categories | `frontend/js/categories.js` |
| Currency list in the picker | `frontend/js/currencies.js` |
| Exchange rate source or cache duration | `backend/services/fx.py` |

---

## Notes

- **Local use only** — there is no authentication. Do not expose this to the internet without adding a login layer first.
- **Exchange rates** require an internet connection at least once per 12 hours; everything else works fully offline.
- **Additional credit cards** share the primary card's balance and credit line. After paying the primary card from savings (using Transfer), click **Settle billing cycle** on the primary card page to reset the additional cards' display balances for the new cycle.
- **Transfers** between your own products (paying a card, funding a time deposit, moving money between accounts) are excluded from the spending-by-category breakdown — they're not real income or expense.

---

## Roadmap

- [ ] Authentication (needed before any online deployment)
- [ ] Bank statement import (CSV/Excel)
- [ ] Online hosting
- [ ] AI-powered spending insights

---

## License

MIT — do whatever you like with it.
