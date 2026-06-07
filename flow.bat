@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PORT=8787"
set "KEY=sk-notion-bridge-test-2026"
set "PIDFILE=%ROOT%\bridge.pid"
set "ROUTER_PORT=20128"

echo.
echo === Notion-AI-Bridge launcher ===
echo Project: %ROOT%
echo.

REM ── Install deps if needed (one-time per clone) ─────────────────────────
if not exist "%ROOT%\node_modules" (
    echo node_modules missing. Running npm install one-time ...
    pushd "%ROOT%"
    call npm install
    set "RC=!errorlevel!"
    popd
    if not "!RC!"=="0" (
        echo npm install failed.
        pause
        exit /b !RC!
    )
    echo.
)

REM ── 9router: start if not already listening ─────────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r = Get-NetTCPConnection -LocalPort %ROUTER_PORT% -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($r) { Write-Host ('9router already up on port %ROUTER_PORT% (PID ' + $r.OwningProcess + ')') -ForegroundColor DarkGray; exit 0 };" ^
  "Write-Host '9router not running. Will start it in a new window.' -ForegroundColor Yellow;" ^
  "exit 1"

if errorlevel 1 (
    echo.
    start "9router" cmd /c "cd /d C:\Users\ollama && 9router"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "for ($i=0; $i -lt 15; $i++) {" ^
      "  $c = Get-NetTCPConnection -LocalPort %ROUTER_PORT% -State Listen -ErrorAction SilentlyContinue;" ^
      "  if ($c) { Write-Host ('9router up on port %ROUTER_PORT% (PID ' + $c.OwningProcess + ')') -ForegroundColor Green; exit 0 };" ^
      "  Start-Sleep -Seconds 1" ^
      "};" ^
      "Write-Host 'ERROR: 9router did not bind port %ROUTER_PORT% in 15s.' -ForegroundColor Red;" ^
      "Write-Host 'Open the 9router window that just opened to see what failed.' -ForegroundColor Red;" ^
      "exit 1"
    if errorlevel 1 ( echo. & pause & exit /b 1 )
)

REM ── Bridge: already-running check ────────────────────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "if (Test-Path '%PIDFILE%') {" ^
  "  $pidOld = (Get-Content '%PIDFILE%' -ErrorAction SilentlyContinue | Select-Object -First 1);" ^
  "  if ($pidOld -and (Get-Process -Id $pidOld -ErrorAction SilentlyContinue).ProcessName -eq 'node') {" ^
  "    Write-Host ('Bridge already running (PID ' + $pidOld + '). Run flow-stop.bat first.') -ForegroundColor Yellow;" ^
  "    exit 1" ^
  "  }" ^
  "  if ($pidOld) { Write-Host ('Stale PID file (PID ' + $pidOld + ' not alive). Cleaning up.') -ForegroundColor DarkGray }" ^
  "  Remove-Item '%PIDFILE%' -ErrorAction SilentlyContinue" ^
  "}"
if errorlevel 1 ( echo. & pause & exit /b 1 )

REM ── Start the bridge in a minimized window, save PID ────────────────────
echo.
echo Starting bridge on port %PORT% ...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Set-Location '%ROOT%';" ^
  "$env:PORT = '%PORT%';" ^
  "$p = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory '%ROOT%' -WindowStyle Minimized -PassThru;" ^
  "if (-not $p) { Write-Host 'ERROR: Start-Process returned null.' -ForegroundColor Red; exit 1 };" ^
  "$p.Id | Out-File -FilePath '%PIDFILE%' -Encoding ascii -NoNewline;" ^
  "Write-Host ('Bridge PID: ' + $p.Id + '  (saved to bridge.pid)')"
if errorlevel 1 ( echo. & pause & exit /b 1 )

REM ── Wait for bridge to bind + health check ──────────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 15; $i++) {" ^
  "  if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) {" ^
  "    try {" ^
  "      $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/health' -Headers @{Authorization='Bearer %KEY%'} -UseBasicParsing -TimeoutSec 5;" ^
  "      Write-Host ('Health: HTTP ' + $r.StatusCode + ' in ' + $r.ElapsedMilliseconds + 'ms') -ForegroundColor Green" ^
  "    } catch { Write-Host ('Port %PORT% bound but /health failed: ' + $_.Exception.Message) -ForegroundColor Yellow }" ^
  "    Write-Host '';" ^
  "    Write-Host 'Ready. You can close this window.' -ForegroundColor Green;" ^
  "    Write-Host '';" ^
  "    Write-Host 'Useful commands:' -ForegroundColor DarkGray;" ^
  "    Write-Host '  flow-stop.bat          stop the bridge (close 9router window manually)' -ForegroundColor DarkGray;" ^
  "    Write-Host '  flow-logs.bat          tail server.log' -ForegroundColor DarkGray;" ^
  "    Write-Host '  curl http://127.0.0.1:%PORT%/v1/models -H ''Authorization: Bearer sk-notio...2026''' -ForegroundColor DarkGray;" ^
  "    exit 0" ^
  "  };" ^
  "  Start-Sleep -Seconds 1" ^
  "};" ^
  "Write-Host 'ERROR: Port %PORT% did not bind in 15s. The bridge window may show the real error.' -ForegroundColor Red;" ^
  "exit 1"

echo.
pause
endlocal
