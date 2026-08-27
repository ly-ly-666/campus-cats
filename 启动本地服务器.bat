@echo off
title Campus Cat Server
cd /d "%~dp0"
echo.
echo ========================================
echo   Campus Cat Local Server
echo ========================================
echo.

REM Check port 8765
netstat -an | findstr :8765 >nul
if not errorlevel 1 (
  echo [Warning] Port 8765 already in use
  echo.
)

REM Start Node.js server (serve.js)
if exist "%~dp0serve.js" (
  echo Starting Node.js server on port 8765...
  start "" node "%~dp0serve.js"
) else (
  echo Starting Python server on port 8765...
  start "" python -m http.server 8765
)

REM Wait for server
timeout /t 2 /nobreak >nul

echo.
echo Server started!
echo Visit: http://localhost:8765/local-admin.html
echo.
echo Press any key to open browser...
pause >nul

start "" http://localhost:8765/local-admin.html
