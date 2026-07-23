"""
Database migration script — safe to run multiple times.

Applies every schema change since the initial release, skipping anything
that's already been applied. Run this once from the backend/ folder
whenever you pull a new version of the app:

    python migrate.py

A fresh install doesn't need this — SQLAlchemy creates the correct
schema on first run automatically.
"""
import sqlite3

DB_PATH = "finance.db"

MIGRATIONS = [
    # MVP 1.3 — transaction categories
    "ALTER TABLE transactions ADD COLUMN category TEXT",

    # MVP 1.5 — products
    "ALTER TABLE products ADD COLUMN interest_rate REAL",

    # MVP 1.5 — transfers
    "ALTER TABLE transactions ADD COLUMN is_transfer BOOLEAN DEFAULT 0 NOT NULL",
    "ALTER TABLE transactions ADD COLUMN transfer_pair_id INTEGER",

    # MVP 1.5 — exchange rate previous value (for the ticker)
    "ALTER TABLE exchange_rates ADD COLUMN previous_rate_to_usd REAL",

    # MVP 1.5 — transaction templates
    # (new table — created by SQLAlchemy automatically if it doesn't exist;
    #  listed here for documentation only, ALTER TABLE not needed)

    # MVP 1.6 — billing cycle settlements
    "ALTER TABLE transactions ADD COLUMN is_settlement BOOLEAN DEFAULT 0 NOT NULL",
]


def run():
    conn = sqlite3.connect(DB_PATH)
    applied = 0
    skipped = 0
    for stmt in MIGRATIONS:
        try:
            conn.execute(stmt)
            conn.commit()
            print(f"  OK  {stmt[:80]}")
            applied += 1
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                skipped += 1
            else:
                print(f"  ERR {stmt[:80]}")
                print(f"      {e}")
    conn.close()
    print(f"\nDone — {applied} applied, {skipped} already existed.")


if __name__ == "__main__":
    run()
