@echo off
setlocal enabledelayedexpansion
title PHQ Dashboard - One-Time Bootstrap Update
color 0A

REM ============================================================
REM  bootstrap-update.bat
REM
REM  PURPOSE: Break the "chicken and egg" deployment problem.
REM
REM  PROBLEM:
REM    The running backend has a flaw — it tries to spawn
REM    deploy.bat via PowerShell, but Windows Server 2022
REM    places all spawned processes in PM2's Job Object.
REM    When deploy.bat runs "pm2 stop", Node.js terminates
REM    and Windows kills deploy.bat with it (self-destruct).
REM
REM  THIS SCRIPT:
REM    1. Git-pulls the latest code (which has the fix)
REM    2. Rebuilds only the backend (fast, ~1 minute)
REM    3. Creates the "PHQDeploy" Windows Scheduled Task
REM    4. Restarts the backend via PM2
REM
REM  After this runs once, the UI Update button works forever.
REM
REM  RUN AS ADMINISTRATOR (right-click -> Run as administrator)
REM ============================================================

echo.
echo ============================================================
echo   PHQ Dashboard - Bootstrap Update (Run Once)
echo ============================================================
echo.

REM ── Check admin privileges ────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] This script must be run as Administrator.
    echo  Right-click bootstrap-update.bat and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

REM ── Resolve project root ──────────────────────────────────────────────────────
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo  Project root: %ROOT%
echo.

REM ── STEP 1: Git pull latest code ──────────────────────────────────────────────
echo [1/4] Pulling latest code from GitHub (main)...
git fetch origin main
if errorlevel 1 (
    echo  [FAIL] git fetch failed. Check internet / repo access.
    pause & exit /b 1
)
git reset --hard origin/main
if errorlevel 1 (
    echo  [FAIL] git reset failed.
    pause & exit /b 1
)
echo  [OK]  Code updated to latest commit.
echo.

REM ── STEP 2: Rebuild backend only ──────────────────────────────────────────────
echo [2/4] Rebuilding backend...
cd "%ROOT%\backend"

echo   npm install...
call npm install --prefer-offline --loglevel=error
if errorlevel 1 (
    cd "%ROOT%"
    echo  [FAIL] Backend npm install failed.
    pause & exit /b 1
)

echo   Generating Prisma client...
call npx prisma generate >nul 2>&1

echo   Compiling TypeScript...
call npm run build
if errorlevel 1 (
    cd "%ROOT%"
    echo  [FAIL] Backend TypeScript build failed.
    pause & exit /b 1
)
cd "%ROOT%"
echo  [OK]  Backend rebuilt.
echo.

REM ── STEP 3: Create PHQDeploy scheduled task ───────────────────────────────────
echo [3/4] Creating "PHQDeploy" Windows Scheduled Task...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\create-deploy-task.ps1" -InstallDir "%ROOT%"
if errorlevel 1 (
    echo  [WARN] Scheduled task creation may have failed.
    echo         Check output above. You can re-run:
    echo         powershell -ExecutionPolicy Bypass -File scripts\create-deploy-task.ps1
    echo.
) else (
    echo  [OK]  PHQDeploy scheduled task is registered.
    echo.
)

REM ── STEP 4: Restart backend via PM2 ──────────────────────────────────────────
echo [4/4] Restarting backend with new code...
call pm2 restart grievance-backend
if errorlevel 1 (
    echo  [WARN] pm2 restart returned an error.
    echo         Try manually: pm2 restart grievance-backend
) else (
    call pm2 save >nul 2>&1
    echo  [OK]  Backend restarted.
)
echo.

REM ── Done ──────────────────────────────────────────────────────────────────────
echo ============================================================
echo   DONE! Bootstrap complete.
echo.
echo   The UI Update button will now work correctly.
echo.
echo   To verify the scheduled task was created:
echo     schtasks /query /tn PHQDeploy
echo.
echo   To test a full deploy manually:
echo     schtasks /run /tn PHQDeploy
echo   then watch: logs\deploy.log
echo ============================================================
echo.
pause
