@echo off
echo Setting up Python environment...
python -m venv venv
call venv\Scripts\activate.bat
echo Installing requirements...
pip install -r requirements.txt
echo.
echo Setup complete! To start the server, run start_server.bat
pause
