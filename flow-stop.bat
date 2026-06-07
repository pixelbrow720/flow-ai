@echo off
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PIDFILE=%ROOT%\bridge.pid"
set "PORT=8787"

echo.
echo === Notion-AI-Bridge stopper ===
echo.

if not exist "%PIDFILE%" (
    echo No bridge.pid found. Trying by port %PORT% ...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$conn = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue;" ^
      "if (-not $conn) { Write-Host 'Nothing listening on port %PORT%.' -ForegroundColor Yellow; exit 1 };" ^
      "$node = Get-CimInstance Win32_Process -Filter (\"ProcessId = \" + $conn.OwningProcess);" ^
      "if ($node -and $node.Name -eq 'node.exe') {" ^
      "  Write-Host ('Killing node.exe PID ' + $conn.OwningProcess + ' (no parent, listening on %PORT%)') -ForegroundColor Yellow;" ^
      "  Stop-Process -Id $conn.OwningProcess -Force;" ^
      "  Start-Sleep -Milliseconds 500;" ^
      "  Write-Host 'Stopped.' -ForegroundColor Green; exit 0" ^
      "} else {" ^
      "  Write-Host ('Port %PORT% is held by ' + $node.Name + ' (PID ' + $conn.OwningProcess + ') - not node. Refusing to kill.') -ForegroundColor Red; exit 1" ^
      "}"
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$pidOld = (Get-Content '%PIDFILE%' -ErrorAction SilentlyContinue | Select-Object -First 1);" ^
  "if (-not $pidOld) { Write-Host 'bridge.pid is empty.' -ForegroundColor Yellow; Remove-Item '%PIDFILE%' -ErrorAction SilentlyContinue; exit 1 };" ^
  "$alive = Get-Process -Id $pidOld -ErrorAction SilentlyContinue;" ^
  "if (-not $alive) {" ^
  "  Write-Host ('PID ' + $pidOld + ' is not running. Cleaning up stale pid file.') -ForegroundColor DarkGray;" ^
  "  Remove-Item '%PIDFILE%' -ErrorAction SilentlyContinue; exit 0" ^
  "};" ^
  "if ($alive.ProcessName -ne 'node') {" ^
  "  Write-Host ('PID ' + $pidOld + ' is ' + $alive.ProcessName + ', not node.exe. Refusing to kill.') -ForegroundColor Red; exit 1" ^
  "};" ^
  "Write-Host ('Stopping bridge (PID ' + $pidOld + ') ...') -ForegroundColor Yellow;" ^
  "Stop-Process -Id $pidOld -Force;" ^
  "for ($i=0; $i -lt 10; $i++) { if (-not (Get-Process -Id $pidOld -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 };" ^
  "if (Get-Process -Id $pidOld -ErrorAction SilentlyContinue) { Write-Host 'Process did not die in 5s.' -ForegroundColor Red; exit 1 };" ^
  "$stillBound = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($stillBound) { Write-Host ('Port %PORT% still bound by PID ' + $stillBound.OwningProcess + ' - not us.') -ForegroundColor Red; exit 1 };" ^
  "Remove-Item '%PIDFILE%' -ErrorAction SilentlyContinue;" ^
  "Write-Host 'Bridge stopped. Port %PORT% free.' -ForegroundColor Green"

echo.
pause
endlocal
