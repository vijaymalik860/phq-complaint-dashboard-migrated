@echo off
setlocal enabledelayedexpansion
title PHQ Complaint Dashboard - Deploy Update
color 0B

REM ============================================================
REM PHQ Complaint Dashboard — Deploy / Update Script
REM Run this every time new code is pushed to master.
REM First time? Run install.bat instead.
REM
REM What this does:
REM   1. Check prerequisites (node, git, pm2, .env)
REM   2. Back up current build for safe rollback
REM   3. Pull latest code from GitHub (master branch)
REM   4. Install / update backend dependencies
REM   5. Build backend (TypeScript → dist/)
REM   6. Build frontend (Vite → frontend/dist/)
REM   7. Apply Prisma schema changes (db push)
REM   8. Restart app via PM2
REM   9. Health check — auto-rollback if failed
REM ============================================================

echo.
echo  ================================================
echo   PHQ Complaint Dashboard  -  Deploy Update
echo  ================================================
echo.

REM ── Paths ─────────────────────────────────────────────────
set "INSTALL_DIR=C:\phq-dashboard"
set "ECOSYSTEM=%INSTALL_DIR%\ecosystem.config.cjs"
set "BACKEND=%INSTALL_DIR%\backend"
set "FRONTEND=%INSTALL_DIR%\frontend"
set "BACKUP=%INSTALL_DIR%\_backup"
set "TARGET_BRANCH=master"

REM Auto-detect if running from install dir or from repo
if not exist "%BACKEND%\package.json" (
    echo  ERROR: Install directory not found at %INSTALL_DIR%
    echo  Please run install.bat first.
    exit /b 1
)

REM ── 1. Check prerequisites ────────────────────────────────────────────────
echo [1/9] Checking prerequisites...
where node >nul 2>&1
if errorlevel 1 ( echo  ERROR: Node.js not installed. Run install.bat first. & exit /b 1 )
where git >nul 2>&1
if errorlevel 1 ( echo  ERROR: Git not installed. Run install.bat first. & exit /b 1 )
where pm2 >nul 2>&1
if errorlevel 1 ( echo  ERROR: PM2 not installed. Run install.bat first. & exit /b 1 )

if not exist "%BACKEND%\.env" (
    echo  ERROR: %BACKEND%\.env missing. Run install.bat first.
    exit /b 1
)

set "APP_PORT=3001"
for /f "usebackq tokens=1,2 delims==" %%A in ("%BACKEND%\.env") do (
    if "%%A"=="PORT" set "APP_PORT=%%B"
)
echo  OK - App port: !APP_PORT!

REM ── 2. Backup current build ───────────────────────────────────────────────
echo.
echo [2/9] Backing up current build for rollback safety...
if exist "%BACKUP%" rmdir /s /q "%BACKUP%" >nul 2>&1
mkdir "%BACKUP%" >nul 2>&1
if exist "%BACKEND%\dist"     xcopy /e /q /i "%BACKEND%\dist"     "%BACKUP%\backend_dist"  >nul 2>&1
if exist "%FRONTEND%\dist"    xcopy /e /q /i "%FRONTEND%\dist"    "%BACKUP%\frontend_dist" >nul 2>&1
echo  OK - Backup saved to %BACKUP%\

REM ── 3. Pull latest code ───────────────────────────────────────────────────
echo.
echo [3/9] Pulling latest code from origin/%TARGET_BRANCH%...
cd /d "%INSTALL_DIR%"
call git fetch origin %TARGET_BRANCH%
call git checkout %TARGET_BRANCH%
call git reset --hard origin/%TARGET_BRANCH%
if errorlevel 1 (
    echo  ERROR: Git pull failed. Check your network and GitHub access.
    exit /b 1
)
echo  OK - Code is up to date.

REM ── 4. Install backend dependencies ──────────────────────────────────────
echo.
echo [4/9] Installing backend dependencies...
echo  (Stopping server temporarily to release file locks)
call pm2 stop phq-dashboard >nul 2>&1

cd /d "%BACKEND%"
call npm install --loglevel=error
if errorlevel 1 ( echo  ERROR: Backend npm install failed & goto :rollback )
echo  OK - Backend dependencies installed.

REM ── 5. Build backend ──────────────────────────────────────────────────────
echo.
echo [5/9] Building backend (TypeScript → dist/)...
call npx prisma generate >nul 2>&1
call npm run build
if errorlevel 1 ( echo  ERROR: Backend build failed & goto :rollback )
echo  OK - Backend built.

REM ── 6. Build frontend ─────────────────────────────────────────────────────
echo.
echo [6/9] Building frontend (Vite → frontend/dist/)...
cd /d "%FRONTEND%"
call npm install --loglevel=error
if errorlevel 1 ( echo  ERROR: Frontend npm install failed & goto :rollback )
call npm run build
if errorlevel 1 ( echo  ERROR: Frontend build failed & goto :rollback )
echo  OK - Frontend built.

REM ── 7. Apply Prisma schema changes ────────────────────────────────────────
echo.
echo [7/9] Applying Prisma schema to database...
cd /d "%BACKEND%"
call npx prisma db push --accept-data-loss
if errorlevel 1 (
    echo  ERROR: Prisma db push failed! Rolling back...
    goto :rollback
)
echo  OK - Database schema up to date.

REM ── 8. Restart via PM2 ────────────────────────────────────────────────────
echo.
echo [8/9] Restarting application...
cd /d "%INSTALL_DIR%"
call pm2 restart phq-dashboard
if errorlevel 1 (
    echo  PM2 restart failed — starting fresh from ecosystem config...
    call pm2 start "%ECOSYSTEM%"
    if errorlevel 1 ( echo  ERROR: PM2 could not start app & goto :rollback )
)
call pm2 save >nul 2>&1
echo  OK - PM2 process restarted.

REM ── 9. Health check ───────────────────────────────────────────────────────
echo.
echo [9/9] Running health check (waiting 15 seconds for warm-up)...
ping 127.0.0.1 -n 16 >nul

set RETRIES=6
:health_loop
if !RETRIES! == 0 goto :health_failed
curl -sf http://localhost:!APP_PORT!/api/health >nul 2>&1
if not errorlevel 1 goto :health_done
set /a RETRIES=!RETRIES!-1
echo  ... Not ready yet. Retrying (!RETRIES! left)...
ping 127.0.0.1 -n 9 >nul
goto :health_loop

:health_failed
echo  FAILED: Application did not become healthy. Rolling back...
goto :rollback

:health_done
echo  OK - Application is healthy!

REM ── Success ───────────────────────────────────────────────────────────────
echo.
echo  ================================================
echo    Deployment SUCCESSFUL!
echo  ================================================
echo.
echo   Dashboard : http://localhost:!APP_PORT!
echo.
echo   Commands:
echo     Status  : pm2 status
echo     Logs    : pm2 logs phq-dashboard
echo     Stop    : pm2 stop phq-dashboard
echo     Restart : pm2 restart phq-dashboard
echo.
exit /b 0

REM ── Rollback ──────────────────────────────────────────────────────────────
:rollback
echo.
echo  ================================================
echo    DEPLOYMENT FAILED - Auto-Rollback Starting
echo  ================================================
echo.

if not exist "%BACKUP%\backend_dist" (
    echo  No backup found — cannot auto-rollback.
    echo  Check logs: pm2 logs phq-dashboard
    exit /b 1
)

echo  Restoring previous build from backup...
if exist "%BACKEND%\dist"  rmdir /s /q "%BACKEND%\dist"  >nul 2>&1
if exist "%FRONTEND%\dist" rmdir /s /q "%FRONTEND%\dist" >nul 2>&1

xcopy /e /q /i "%BACKUP%\backend_dist"  "%BACKEND%\dist"  >nul 2>&1
xcopy /e /q /i "%BACKUP%\frontend_dist" "%FRONTEND%\dist" >nul 2>&1

echo  Restarting with previous build...
call pm2 restart phq-dashboard >nul 2>&1
ping 127.0.0.1 -n 12 >nul

curl -sf http://localhost:!APP_PORT!/api/health >nul 2>&1
if errorlevel 1 (
    echo.
    echo  CRITICAL: Rollback also failed!
    echo  Run manually: pm2 logs phq-dashboard
    echo.
) else (
    echo.
    echo  Rollback SUCCESSFUL - Previous version is live.
    echo  Dashboard: http://localhost:!APP_PORT!
    echo.
)
exit /b 1
