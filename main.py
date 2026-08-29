from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List
import os
import json
import re
import requests
import models
import schemas
from database import engine, get_db

# Create DB tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Time School API")

# --- TEACHERS ---
@app.get("/api/teachers", response_model=List[schemas.Teacher])
def read_teachers(db: Session = Depends(get_db)):
    teachers = db.query(models.Teacher).all()
    # Map snake_case to camelCase for frontend
    return [{"id": t.id, "firstName": t.first_name, "lastName": t.last_name, "phone": t.phone, "subjects": t.subjects, "createdAt": t.created_at} for t in teachers]

@app.post("/api/teachers", response_model=schemas.Teacher)
def create_teacher(teacher: schemas.TeacherCreate, db: Session = Depends(get_db)):
    db_teacher = models.Teacher(
        first_name=teacher.firstName,
        last_name=teacher.lastName,
        phone=teacher.phone,
        subjects=teacher.subjects
    )
    db.add(db_teacher)
    db.commit()
    db.refresh(db_teacher)
    return {"id": db_teacher.id, "firstName": db_teacher.first_name, "lastName": db_teacher.last_name, "phone": db_teacher.phone, "subjects": db_teacher.subjects, "createdAt": db_teacher.created_at}

@app.delete("/api/teachers/{teacher_id}")
def delete_teacher(teacher_id: str, db: Session = Depends(get_db)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not db_teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    db.delete(db_teacher)
    db.commit()
    return {"message": "Teacher deleted"}

# --- TESTS ---
@app.get("/api/tests", response_model=List[schemas.Test])
def read_tests(db: Session = Depends(get_db)):
    tests = db.query(models.Test).all()
    return [{"id": t.id, "teacherId": t.teacher_id, "subject": t.subject, "level": t.level, "duration": t.duration, "questions": t.questions, "createdAt": t.created_at} for t in tests]

@app.post("/api/tests", response_model=schemas.Test)
def create_test(test: schemas.TestCreate, db: Session = Depends(get_db)):
    db_test = models.Test(
        teacher_id=test.teacherId,
        subject=test.subject,
        level=test.level,
        duration=test.duration,
        questions=[q.dict() for q in test.questions]
    )
    db.add(db_test)
    db.commit()
    db.refresh(db_test)
    return {"id": db_test.id, "teacherId": db_test.teacher_id, "subject": db_test.subject, "level": db_test.level, "duration": db_test.duration, "questions": db_test.questions, "createdAt": db_test.created_at}

@app.delete("/api/tests/{test_id}")
def delete_test(test_id: str, db: Session = Depends(get_db)):
    db_test = db.query(models.Test).filter(models.Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    db.delete(db_test)
    db.commit()
    return {"message": "Test deleted"}

# --- AI GENERATION ---
class GenerateTestRequest(BaseModel):
    subject: str
    level: str
    promptText: str

@app.post("/api/generate-test")
def generate_test_api(req: GenerateTestRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan. Iltimos Railway'dan Variables qo'shing.")
    
    api_key = api_key.strip()
        
    try:
        prompt = f"""Generate exactly 50 multiple-choice questions for {req.subject} at {req.level} level in Uzbek language. 
Additional instructions: {req.promptText}.
Return the response ONLY as a valid JSON array of objects. Do NOT include any markdown code blocks, do NOT include ```json. Just the raw array.
Each object must have this exact structure:
{{"question": "Question text here?", "options": ["Option 1", "Option 2", "Option 3", "Option 4"], "correctAnswerIndex": 0}}
Ensure correctAnswerIndex is an integer from 0 to 3."""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={api_key}"
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 1,
                "maxOutputTokens": 65536,
                "topP": 0.95
            }
        }
        
        resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"})
        
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"API xatoligi: {resp.text}")
            
        data_json = resp.json()
        ai_text = data_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        
        match = re.search(r'\[[\s\S]*\]', ai_text)
        if match:
            ai_text = match.group(0)
            
        questions = json.loads(ai_text)
        return {"questions": questions}
    except Exception as e:
        print("AI generation xatosi:", str(e))
        raise HTTPException(status_code=500, detail=str(e))

# --- RESULTS ---
@app.get("/api/results", response_model=List[schemas.Result])
def read_results(db: Session = Depends(get_db)):
    results = db.query(models.Result).all()
    return [{"id": r.id, "studentName": r.student_name, "studentPhone": r.student_phone, "teacherId": r.teacher_id, "level": r.level, "correct": r.correct, "total": r.total, "date": r.date} for r in results]

@app.post("/api/results", response_model=schemas.Result)
def create_result(result: schemas.ResultCreate, db: Session = Depends(get_db)):
    db_result = models.Result(
        student_name=result.studentName,
        student_phone=result.studentPhone,
        teacher_id=result.teacherId,
        level=result.level,
        correct=result.correct,
        total=result.total
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)
    return {"id": db_result.id, "studentName": db_result.student_name, "studentPhone": db_result.student_phone, "teacherId": db_result.teacher_id, "level": db_result.level, "correct": db_result.correct, "total": db_result.total, "date": db_result.date}

# --- STATE SYNC ---
class AppStateSync(BaseModel):
    teachers: list = []
    tests: list = []
    results: list = []
    subjects: list = []

@app.get("/api/state")
def get_state(db: Session = Depends(get_db)):
    state = db.query(models.AppStateDB).filter(models.AppStateDB.id == 1).first()
    if state and state.state_json:
        return json.loads(state.state_json)
    return {"teachers": [], "tests": [], "results": [], "subjects": []}

@app.post("/api/state")
def save_state(state: AppStateSync, db: Session = Depends(get_db)):
    db_state = db.query(models.AppStateDB).filter(models.AppStateDB.id == 1).first()
    if not db_state:
        db_state = models.AppStateDB(id=1, state_json=json.dumps(state.dict()))
        db.add(db_state)
    else:
        db_state.state_json = json.dumps(state.dict())
    db.commit()
    return {"status": "ok"}

# Serve Static Frontend Files
app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
def serve_index():
    return FileResponse("index.html")

@app.get("/{filename}")
def serve_files(filename: str):
    file_path = os.path.join(".", filename)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")
