@echo off
REM ============================================================
REM  start-server.bat - Launch the game on a local HTTP server
REM
REM  Why this is needed:
REM    Browsers treat file:// pages as an opaque origin and block
REM    fetch() / XMLHttpRequest / dynamic import(). MediaPipe needs
REM    those to load its runtime, wasm and model files, so opening
REM    index.html directly can break camera gestures.
REM    (The game now has an inline fallback, but running over HTTP
REM     is faster and always recommended.)
REM
REM  Usage: double-click this file. It starts a server on port 8931
REM         and opens the browser automatically. Close the window
REM         to stop the server.
REM ============================================================
setlocal

cd /d "%~dp0"

set PORT=8931

echo ============================================================
echo   Cooking Game - local server
echo ============================================================
echo.

REM --- Check python ---
where python >nul 2>nul
if %errorlevel%==0 goto :python_found
where py >nul 2>nul
if %errorlevel%==0 goto :py_found

echo [ERROR] Python not found. Install Python 3 from python.org
echo         and run this file again.
echo.
pause
exit /b 1

:python_found
set PY=python
goto :start

:py_found
set PY=py
goto :start

:start
echo [1/2] Starting local server on http://127.0.0.1:%PORT% ...
start "" "http://127.0.0.1:%PORT%/index.html"
echo [2/2] Browser opened. Keep this window open while playing.
echo.
echo Press Ctrl+C to stop the server.
echo.

%PY% -m http.server %PORT% --bind 127.0.0.1

endlocal
