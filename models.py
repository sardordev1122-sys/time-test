from sqlalchemy import Column, String, Integer, DateTime, JSON, Text
from database import Base
import uuid
from datetime import datetime

def generate_uuid():
    return str(uuid.uuid4())

class Teacher(Base):
    __tablename__ = "teachers"

    id = Column(String, primary_key=True, default=generate_uuid)
    first_name = Column(String, index=True)
    last_name = Column(String, index=True)
    phone = Column(String, unique=True, index=True)
    subjects = Column(JSON) # Array of subjects
    created_at = Column(DateTime, default=datetime.utcnow)

class Test(Base):
    __tablename__ = "tests"

    id = Column(String, primary_key=True, default=generate_uuid)
    teacher_id = Column(String, index=True)
    subject = Column(String)
    level = Column(String)
    duration = Column(Integer, default=60)
    questions = Column(JSON) # Array of question objects
    created_at = Column(DateTime, default=datetime.utcnow)

class Result(Base):
    __tablename__ = "results"

    id = Column(String, primary_key=True, default=generate_uuid)
    student_name = Column(String, index=True)
    student_phone = Column(String, index=True)
    teacher_id = Column(String, index=True)
    level = Column(String)
    correct = Column(Integer)
    total = Column(Integer)
    date = Column(DateTime, default=datetime.utcnow)
