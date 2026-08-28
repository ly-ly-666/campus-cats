@echo off
title Campus Cat Local Server
cd /d "%~dp0"

echo.
echo ============================================
echo   Campus Cat (YouMao) Local Server
echo ============================================
echo.

REM --- Only a real listener means a server is running (TIME_WAIT etc. are stale) ---
netstat -ano | findstr LISTENING | findstr ":8765" >nul 2>&1
if not errorlevel 1 (
  echo [Info] Port 8765 is already in use.
  echo        A server may already be running. Open the URL below.
  echo.
  goto :OPEN
)

REM --- Prefer Node.js (serve.js); fall back to Python ---
if exist "%~dp0serve.js" (
  where node >nul 2>&1
  if not errorlevel 1 (
    echo Starting Node.js server on port 8765...
    start "Campus Cat Server" node "%~dp0serve.js"
    goto :WAIT
  )
)

echo Starting Python server on port 8765...
start "Campus Cat Server" python -m http.server 8765

:WAIT
echo Waiting for the server to start...
timeout /t 3 /nobreak >nul

:OPEN
echo.
echo Server is ready!
echo Visit:  http://localhost:8765/local-admin.html
echo.
start "" http://localhost:8765/local-admin.html

echo.
echo A separate console window is running the server.
echo Do not close it, or the server will stop.
echo Press any key to close this window...
pause >nul
