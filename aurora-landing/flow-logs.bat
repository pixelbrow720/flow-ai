@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOG=%ROOT%\server.log"

if not exist "%LOG%" (
    echo No server.log at %LOG%
    pause
    exit /b 1
)

echo Tailing %LOG%  (Ctrl+C to stop)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-Content '%LOG%' -Wait -Tail 30"
