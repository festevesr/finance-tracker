"""
Database connection and session management.

This is the ONLY file that knows about the database engine / connection
string. If you ever switch from SQLite to something else, this is the
only file you should need to touch.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "sqlite:///./finance.db"

# check_same_thread=False is needed because FastAPI can use the same
# connection across different threads in development.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
