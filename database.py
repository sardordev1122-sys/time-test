from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Default to a local postgres DB named 'timeschool' with user 'postgres' and pass '1234'
# You can override this with an environment variable
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:1234@localhost/timeschool")

if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

try:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    with engine.connect() as conn:
        pass # connection successful
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
except Exception:
    print("PostgreSQL topilmadi, xavfsiz tarzda SQLite (Faylli Baza) ga o'tildi. Dastur xatosiz ishlamoqda!")
    # Fallback to SQLite
    SQLALCHEMY_DATABASE_URL = "sqlite:///./timeschool.db"
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
