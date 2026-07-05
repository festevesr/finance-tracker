"""
App entrypoint: creates tables, registers routers, serves the frontend.

To add a new resource (new router file), import it and add one
app.include_router(...) line here. Nothing else in this file should
need to change as the app grows.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import Base, engine
import models  # noqa: F401  (ensures models are registered before create_all)
from routers import banks, products, transactions, exchange_rates, dashboard, templates, transfers

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Personal Finance Tracker")

app.include_router(banks.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(transactions.delete_router)
app.include_router(exchange_rates.router)
app.include_router(dashboard.router)
app.include_router(templates.router)
app.include_router(templates.delete_router)
app.include_router(transfers.router)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")
