@echo off
setlocal enabledelayedexpansion
title Grievance Monitoring System - Deploy Update

REM ============================================================
REM  Grievance Monitoring System - Deploy / Update Script
REM  Run from project root OR triggered via Windows Scheduled
REM  Task "PHQDeploy" (schtasks /run /tn PHQDeploy).
REM
REM  WHY Scheduled Task?
REM  When triggered from Node.js/PM2, child processes share the
REM  same Windows Job Object.  "pm2 stop" kills the Job Object
REM  and terminates this script mid-run.  A Scheduled Task runs
REM  in Session 0 (SYSTEM), outside any Job Object.
REM
REM  Writes a structured timestamped log to:  logs\deploy.log
REM  UI reads this log via GET /api/system/deploy-log
REM ============================================================

REM ── Resolve paths ─────────────────────────────────────────────────────────────
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOG_DIR=%ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\deploy.log"
set "BACKUP_DIR=%ROOT%\_backup"

REM ── Ensure logs directory exists ──────────────────────────────────────────────
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

REM ── Logging helper (:log) writes to stdout AND log file ──────────────────────
REM    Usage: call :log "LEVEL" "Message"
REM    Level: INFO | OK | WARN | FAIL | STEP

REM ── Start ─────────────────────────────────────────────────────────────────────
call :log STEP "=== DEPLOY STARTED ==="

REM ── 1. Check prerequisites ────────────────────────────────────────────────────
call :log STEP "Checking prerequisites (node, git, pm2)..."
where node >nul 2>&1
if errorlevel 1 ( call :log FAIL "Node.js not found. Aborting." & exit /b 1 )
where git  >nul 2>&1
if errorlevel 1 ( call :log FAIL "Git not found. Aborting."       & exit /b 1 )
where pm2  >nul 2>&1
if errorlevel 1 ( call :log FAIL "PM2 not found. Aborting."       & exit /b 1 )
call :log OK "Prerequisites OK."

REM ── 2. Pull latest code ───────────────────────────────────────────────────────
call :log STEP "Pulling latest code from GitHub (main)..."
set "PREV_COMMIT="
for /f "delims=" %%C in ('git rev-parse HEAD 2^>nul') do set "PREV_COMMIT=%%C"

git fetch origin main >nul 2>&1
git checkout main     >nul 2>&1
git reset --hard origin/main
if errorlevel 1 (
    call :log FAIL "Git reset failed. Check network / repo access."
    exit /b 1
)

set "NEW_COMMIT="
for /f "delims=" %%C in ('git rev-parse HEAD 2^>nul') do set "NEW_COMMIT=%%C"
call :log OK "Code updated to commit: !NEW_COMMIT!"

REM ── 3. Backup current dist ────────────────────────────────────────────────────
call :log STEP "Backing up current dist folders..."
if exist "%BACKUP_DIR%" rmdir /s /q "%BACKUP_DIR%" >nul 2>&1
mkdir "%BACKUP_DIR%" >nul 2>&1
if exist "%ROOT%\frontend\dist" xcopy /e /q /i "%ROOT%\frontend\dist" "%BACKUP_DIR%\frontend_dist" >nul 2>&1
if exist "%ROOT%\backend\dist"  xcopy /e /q /i "%ROOT%\backend\dist"  "%BACKUP_DIR%\backend_dist"  >nul 2>&1
call :log OK "Backup saved to _backup\"

REM ── 4. Stop PM2 to release file locks ─────────────────────────────────────────
call :log STEP "Stopping PM2 to release file locks..."
call pm2 stop grievance-backend grievance-frontend >nul 2>&1
call :log OK "PM2 stopped."

REM ── 5. Build Frontend ─────────────────────────────────────────────────────────
call :log STEP "Installing frontend dependencies..."
cd "%ROOT%\frontend"
call npm install --prefer-offline
if errorlevel 1 (
    cd "%ROOT%"
    call :log FAIL "Frontend npm install failed."
    goto :rollback
)
call :log STEP "Building frontend..."
call npm run build
if errorlevel 1 (
    cd "%ROOT%"
    call :log FAIL "Frontend build failed."
    goto :rollback
)
cd "%ROOT%"
call :log OK "Frontend built successfully."

REM ── 6. Build Backend ──────────────────────────────────────────────────────────
call :log STEP "Installing backend dependencies..."
cd "%ROOT%\backend"
call npm install --prefer-offline
if errorlevel 1 (
    cd "%ROOT%"
    call :log FAIL "Backend npm install failed."
    goto :rollback
)
call :log STEP "Generating Prisma client..."
call npx prisma generate >nul 2>&1
call :log STEP "Compiling TypeScript..."
call npm run build
if errorlevel 1 (
    cd "%ROOT%"
    call :log FAIL "Backend build (tsc) failed."
    goto :rollback
)
cd "%ROOT%"
call :log OK "Backend built successfully."

REM ── 7. Apply DB schema changes ────────────────────────────────────────────────
call :log STEP "Applying database schema changes (prisma db push)..."
cd "%ROOT%\backend"
call npx prisma db push --accept-data-loss
if errorlevel 1 (
    cd "%ROOT%"
    call :log FAIL "prisma db push failed."
    goto :rollback
)
cd "%ROOT%"
call :log OK "Database schema verified and updated."

REM ── 8. Restart via PM2 ────────────────────────────────────────────────────────
call :log STEP "Restarting application via PM2..."
call pm2 restart grievance-backend grievance-frontend
call pm2 save >nul 2>&1
call :log OK "PM2 restarted."

REM ── 9. Health Check ───────────────────────────────────────────────────────────
call :log STEP "Running health check (waiting 20 seconds for startup)..."
ping 127.0.0.1 -n 21 >nul

set APP_PORT=3001
if exist "%ROOT%\backend\.env" (
    for /f "usebackq tokens=1,2 delims==" %%A in ("%ROOT%\backend\.env") do (
        if "%%A"=="PORT" set "APP_PORT=%%B"
    )
)
set "APP_PORT=%APP_PORT:"=%"

set RETRIES=6
:health_loop
if "%RETRIES%"=="0" goto :health_failed
curl -sf http://localhost:%APP_PORT%/api/health >nul 2>&1
if not errorlevel 1 goto :health_done
if not "%APP_PORT%"=="3001" (
    curl -sf http://localhost:3001/api/health >nul 2>&1
    if not errorlevel 1 ( set "APP_PORT=3001" & goto :health_done )
)
set /a RETRIES=RETRIES-1
call :log INFO "Not ready yet. Retrying (%RETRIES% left)..."
ping 127.0.0.1 -n 11 >nul
goto :health_loop

:health_failed
call :log FAIL "Health check failed after all retries. Rolling back..."
goto :rollback

:health_done
call :log OK "Health check passed. Application is live at http://localhost:%APP_PORT%"
call :log STEP "=== DEPLOY SUCCESSFUL === commit=!NEW_COMMIT!"
exit /b 0

REM ── Rollback ──────────────────────────────────────────────────────────────────
:rollback
call :log STEP "--- ROLLBACK STARTED ---"
if not exist "%BACKUP_DIR%" (
    call :log FAIL "No backup found. Cannot rollback."
    exit /b 1
)
if exist "%ROOT%\frontend\dist" rmdir /s /q "%ROOT%\frontend\dist" >nul 2>&1
if exist "%ROOT%\backend\dist"  rmdir /s /q "%ROOT%\backend\dist"  >nul 2>&1
if exist "%BACKUP_DIR%\frontend_dist" xcopy /e /q /i "%BACKUP_DIR%\frontend_dist" "%ROOT%\frontend\dist" >nul 2>&1
if exist "%BACKUP_DIR%\backend_dist"  xcopy /e /q /i "%BACKUP_DIR%\backend_dist"  "%ROOT%\backend\dist"  >nul 2>&1
call pm2 restart grievance-backend grievance-frontend >nul 2>&1
ping 127.0.0.1 -n 11 >nul
curl -sf http://localhost:%APP_PORT%/api/health >nul 2>&1
if errorlevel 1 (
    call :log FAIL "Rollback complete but health check still failing. Run: pm2 logs"
) else (
    call :log OK "Rollback complete. Previous stable version is live."
)
call :log STEP "--- ROLLBACK DONE ---"
call :log STEP "=== DEPLOY FAILED - ROLLED BACK ==="
exit /b 1

REM ── :log subroutine ───────────────────────────────────────────────�