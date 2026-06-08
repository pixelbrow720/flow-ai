@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PF86=C:\Program Files (x86)"

echo.
echo === Notion-AI-Bridge setup ===
echo Project: %ROOT%
echo.
echo This logs you in to Notion, captures your session, and (optionally)
echo points the bridge at a custom agent. If config.json already exists it
echo is refreshed -- your apiKey and agent settings are preserved.
echo.

REM ── Prereq: Node.js ─────────────────────────────────────────────────────
where node >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found on PATH.
    echo Install from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)
for /f "delims=" %%V in ('node --version') do echo Node.js: %%V

REM ── Prereq: Microsoft Edge ───────────────────────────────────────────────
if exist "!PF86!\Microsoft\Edge\Application\msedge.exe" (
    echo Edge:    !PF86!\Microsoft\Edge\Application\msedge.exe
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    echo Edge:    %ProgramFiles%\Microsoft\Edge\Application\msedge.exe
) else (
    echo ERROR: Microsoft Edge not found.
    echo Install from https://www.microsoft.com/edge
    pause
    exit /b 1
)

REM ── Install deps if needed ──────────────────────────────────────────────
if not exist "%ROOT%\node_modules" (
    echo.
    echo Installing dependencies via npm install, one-time, about 1 min ...
    pushd "%ROOT%"
    call npm install
    set "RC=!errorlevel!"
    popd
    if not "!RC!"=="0" (
        echo npm install failed. See output above.
        pause
        exit /b !RC!
    )
) else (
    echo Deps:    %ROOT%\node_modules  -- exists, skipping npm install
)

echo.
echo Launching Edge so you can log in to your Notion account ...
echo The script will auto-detect login and capture your workspace.
echo.

pushd "%ROOT%"
node flow-setup.js
set "RC=!errorlevel!"
popd

if not "!RC!"=="0" (
    echo.
    echo Setup failed. See error above.
    pause
    exit /b !RC!
)

echo.
echo All good. Next step: double-click flow.bat to start the bridge.
pause
endlocal

