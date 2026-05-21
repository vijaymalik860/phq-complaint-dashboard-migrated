@echo off
setlocal enabledelayedexpansion
title Grievance Monitoring System - Deploy Update
color 0B

REM ============================================================
REM Grievance Monitoring System - Deploy / Update Script
REM Adapted from Court Portal reference to match the same server architecture.
REM ============================================================

echo.
echo  ================================================
echo   Grievance Monitoring System  -  Deploy Update
echo  ================================================
echo.

REM ── 1. Check prerequisites ────────────────────────────────
echo [1/7] Checking prerequisites...
where node >nul 2>&1
if errorlevel 1 ( echo  ERROR: Node.js not installed. & exit /b 1 )
where git >nul 2>&1
if errorlevel 1 ( echo  ERROR: Git not installed. & exit /b 1 )
where pm2 >nul 2>&1
if errorlevel 1 ( echo  ERROR: PM2 not installed. & exit /b 1 )

set "APP_PORT=3001"
if exist "backend\.env" (
    for /f "usebackq tokens=1,2 delims==" %%A in ("backend\.env") do (
        if "%%A"=="PORT" set APP_PORT=%%B
    )
)
set "APP_PORT=%APP_PORT:"=%"
echo  OK - App port detected as %APP_PORT%

REM ── 2. Backup current build for rollback ─────────────────
echo.
echo [2/7] Backing up current build for rollback safety...
if exist "_backup" rmdir /s /q _backup >nul 2>&1
mkdir _backup >nul 2>&1
if exist "frontend\dist" xcopy /e /q /i frontend\dist _backup\frontend_dist >nul 2>&1
if exist "backend\dist" xcopy /e /q /i backend\dist _backup\backend_dist >nul 2>&1
echo  OK - Backup saved to _backup\

REM ── 3. Pull latest code ───────────────────────────────────
echo.
echo [3/7] Pulling latest code from origin...

set TARGET_BRANCH=main

git fetch origin %TARGET_BRANCH%
git checkout %TARGET_BRANCH%
git reset --hard origin/%TARGET_BRANCH%
if errorlevel 1 (
    echo  ERROR: Git pull failed. Check network and repo access.
    exit /b 1
)
echo  OK - Code up to date.

REM ── 4. Install dependencies ───────────────────────────────
echo.
echo [4/7] Installing dependencies...
echo  (Stopping PM2 servers temporarily to release Windows File Locks)
call pm2 stop grievance-backend grievance-frontend >nul 2>&1

cd backend
call npm install
if errorlevel 1 ( cd .. & echo  ERROR: Backend npm install failed & goto :rollback )
cd ..

cd frontend
call npm install
if errorlevel 1 ( cd .. & echo  ERROR: Frontend npm install failed & goto :rollback )
cd ..

echo  OK - Dependencies installed.

REM ── 5. Build frontend and backend ─────────────────────────
echo.
echo [5/7] Building frontend and backend...

cd frontend
call npm run build
if errorlevel 1 ( cd .. & echo  ERROR: Frontend build failed & goto :rollback )
cd ..

cd backend
call npm run build
if errorlevel 1 ( cd .. & echo  ERROR: Backend build failed & goto :rollback )
cd ..

echo  OK - Frontend and backend built.

REM ── Generate Prisma client ────────────────────────────────
cd backend
call npx prisma generate >nul 2>&1
cd ..

REM ── 6. Apply DB changes ───────────────────────────────────
echo.
echo [6/7] Applying database changes...
cd backend
call npx prisma db push --accept-data-loss
if errorlevel 1 (
    cd ..
    echo  ERROR: DB push failed! Rolling back...
    goto :rollback
)
cd ..
echo  OK - Database changes applied.

REM ── 7. Restart app via PM2 ────────────────────────────────
echo.
echo [7/7] Restarting app...
call pm2 restart grievance-backend grievance-frontend
if errorlevel 1 (
    echo  ERROR: PM2 restart failed.
)
call pm2 save >nul 2>&1

REM ── Health Check ──────────────────────────────────────────
echo.
echo  Running health check (waiting 15 seconds)...
ping 127.0.0.1 -n 16 >nul

set RETRIES=5
:health_loop
if "%RETRIES%"=="0" goto :health_failed

rem Try the detected APP_PORT first
curl -sf http://localhost:%APP_PORT%/api/health >nul 2>&1
if not errorlevel 1 goto :health_done

rem If APP_PORT is not 3001, also try port 3001 as a backup fallback
if not "%APP_PORT%"=="3001" (
    curl -sf http://localhost:3001/api/health >nul 2>&1
    if not errorlevel 1 (
        set "APP_PORT=3001"
        goto :health_done
    )
)

set /a RETRIES=RETRIES-1
echo  ... Not ready. Retrying (%RETRIES% left)
ping 127.0.0.1 -n 9 >nul
goto :health_loop

:health_failed
echo  FAILED: App did not become healthy. Rolling back...
goto :rollback

:health_done
echo  OK - Application is healthy!

REM ── Success ───────────────────────────────────────────────
echo.
echo  ================================================
echo    Deployment SUCCESSFUL!
echo  ================================================
echo.
echo   Portal: http://localhost:%APP_PORT%/api/health
echo.
exit /b 0

REM ── Rollback ─────────────────────────────────────────────
:rollback
echo.
echo  ================================================
echo    DEPLOYMENT FAILED - Auto-Rollback Starting
echo  ================================================
echo.
if not exist "_backup" (
    echo  No backup found. Cannot auto-rollback.
    exit /b 1
)
echo  Restoring previous build...
if exist "frontend\dist" rmdir /s /q frontend\dist >nul 2>&1
if exist "backend\dist" rmdir /s /q backend\dist >nul 2>&1

if exist "_backup\frontend_dist" xcopy /e /q /i _backup\frontend_dist frontend\dist >nul 2>&1
if exist "_backup\backend_dist" xcopy /e /q /i _backup\backend_dist backend\dist >nul 2>&1

echo  Restarting with previous build...
call pm2 restart grievance-backend grievance-frontend
ping 127.0.0.1 -n 11 >nul
curl -sf http://localhost:%APP_PORT%/api/health >nul 2>&1
if errorlevel 1 (
    if not "%APP_PORT%"=="3001" (
        curl -sf http://localhost:3001/api/health >nul 2>&1
    )
)
if errorlevel 1 (
    echo  CRITICAL: Rollback also failed! Run: pm2 logs
) else (
    echo  Rollback SUCCESSFUL - Previous version is live.
)
echo.
exit /b 1
