@echo off
echo Starting Time School Backend Server...
call venv\Scripts\activate.bat
uvicorn main:app --reload
