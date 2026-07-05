"""
POST /api/transfers creates a linked pair of transactions (outflow on
the source product, inflow on the destination) — see
services/transfers.py for the actual logic.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import schemas
from database import get_db
from services import transfers as transfers_service

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


@router.post("", response_model=schemas.TransferOut, status_code=201)
def create_transfer(payload: schemas.TransferCreate, db: Session = Depends(get_db)):
    source_tx, destination_tx = transfers_service.create_transfer(db, payload)
    return schemas.TransferOut(source_transaction=source_tx, destination_transaction=destination_tx)
