@echo off
setlocal

cd /d "%~dp0"

if not exist "package.json" (
  echo package.json not found. Run this file from the project folder.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js first:
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env.local" (
  if exist ".env.example" (
    copy ".env.example" ".env.local" >nul
    echo Created .env.local from .env.example.
    echo Add your GEMINI_API_KEY to .env.local if you have not done that yet.
  )
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting project at http://localhost:3000
call npm run dev

pause
