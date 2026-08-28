from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

# Teacher Schemas
class TeacherBase(BaseModel):
    firstName: str
    lastName: str
    phone: str
    subjects: List[str]

class TeacherCreate(TeacherBase):
    pass

class Teacher(TeacherBase):
    id: str
    createdAt: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Schemas
class QuestionBase(BaseModel):
    question: str
    options: List[str]
    answer: int

class TestBase(BaseModel):
    teacherId: str
    subject: str
    level: str
    duration: int
    questions: List[QuestionBase]

class TestCreate(TestBase):
    pass

class Test(TestBase):
    id: str
    createdAt: Optional[datetime] = None

    class Config:
        from_attributes = True


# Result Schemas
class ResultBase(BaseModel):
    studentName: str
    studentPhone: str
    teacherId: str
    level: str
    correct: int
    total: int

class ResultCreate(ResultBase):
    pass

class Result(ResultBase):
    id: str
    date: Optional[datetime] = None

    class Config:
        from_attributes = True
