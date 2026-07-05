"""
Transaction templates: saved "shapes" of a transaction (everything
except the date) for quick reuse — rent, salary, subscriptions, or
anything else you enter repeatedly. There's no automatic scheduling
here on purpose: the app never creates a transaction by itself, it
just gives the frontend something to pre-fill the add-transaction
dialog with.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter(prefix="/api/products/{product_id}/templates", tags=["templates"])
delete_router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=list[schemas.TemplateOut])
def list_templates(product_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.TransactionTemplate)
        .filter(models.TransactionTemplate.product_id == product_id)
        .order_by(models.TransactionTemplate.name)
        .all()
    )


@router.post("", response_model=schemas.TemplateOut, status_code=201)
def create_template(product_id: int, payload: schemas.TemplateCreate, db: Session = Depends(get_db)):
    if not db.query(models.Product).get(product_id):
        raise HTTPException(404, "Product not found")

    if payload.direction not in models.TRANSACTION_DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {models.TRANSACTION_DIRECTIONS}")

    template = models.TransactionTemplate(product_id=product_id, **payload.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@delete_router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    template = db.query(models.TransactionTemplate).get(template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    db.delete(template)
    db.commit()
