@echo off
cd /d "%~dp0backend"
if not exist .venv (
  echo Creating Python environment...
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
echo.
echo  Suraksha Band is running:
echo    Home        http://localhost:8000/
echo    Dashboard   http://localhost:8000/dashboard/
echo    Tourist app http://localhost:8000/tourist/
echo    Simulator   http://localhost:8000/simulator/
echo    API docs    http://localhost:8000/docs
echo.
start "" http://localhost:8000/
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
