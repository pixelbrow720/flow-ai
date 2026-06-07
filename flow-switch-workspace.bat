@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PF86=C:\Program Files (x86)"

echo.
echo === Notion-AI-Bridge workspace switcher ===
echo Project: %ROOT%
echo.

where node >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found on PATH.
    echo Install from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

if exist "!PF86!\Microsoft\Edge\Application\msedge.exe" (
    echo Edge:    !PF86!\Microsoft\Edge\Application\msedge.exe
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    echo Edge:    %ProgramFiles%\Microsoft\Edge\Application\msedge.exe
) else (
    echo ERROR: Microsoft Edge not found.
    pause
    exit /b 1
)

if not exist "%ROOT%\node_modules" (
    echo Installing dependencies via npm install, one-time ...
    pushd "%ROOT%"
    call npm install
    set "RC=!errorlevel!"
    popd
    if not "!RC!"=="0" (
        echo npm install failed.
        pause
        exit /b !RC!
    )
)

pushd "%ROOT%"
node flow-switch-workspace.js
set "RC=!errorlevel!"
popd

if not "!RC!"=="0" (
    echo.
    echo Switcher failed. See error above.
    pause
    exit /b !RC!
)

echo.
pause
endlocal
