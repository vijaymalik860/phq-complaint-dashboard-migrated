<# :
@echo off
setlocal disabledelayedexpansion
title Grievance Monitoring System - Deploy Update
color 0B

if "%DEPLOY_NO_ELEVATION%"=="true" goto :skip_elevation_check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
:skip_elevation_check

echo.
echo ============================================================
echo   Grievance Monitoring System - Deploy Update
echo   Haryana Police Headquarters
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -Encoding UTF8 '%~f0') -join [Environment]::NewLine)"

exit /b 0
#>

# ==============================================================================
# Deploy Update Script
# 1. Pull latest code from GitHub  (git fetch + reset --hard origin/main)
# 2. Backup current dist folders   (for safe rollback if new build fails)
# 3. Build frontend  (npm install + npm run build)
# 4. Build backend   (npm install + prisma generate + npm run build)
# 5. Apply DB schema changes       (prisma db push)
# 6. Restart PM2 processes
# 7. Health check — if failed, restore dist backup + rollback git + restart
# ==============================================================================

$ErrorActionPreference = "Stop"

$InstallDir    = "C:\PHQ-Dashboard"
$AppPort       = 3001
$LogFile       = Join-Path $InstallDir "logs\deploy.log"
$BackupDir     = Join-Path $InstallDir ".deploy-backup"

# $IsInteractive = true when run manually from a terminal;
#                  false when spawned by the backend API (DEPLOY_NO_ELEVATION=true is set by install.bat services)
#                  We also detect no console by checking the environment variable set by DevTools route.
$IsInteractive = ($env:DEPLOY_NO_ELEVATION -ne "true") -and ($env:DEPLOY_BACKGROUND -ne "true")

# Attempt to load custom PORT from backend/.env if available
$envPath = Join-Path $InstallDir "backend\.env"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath
    foreach ($line in $envContent) {
        if ($line -match '^\s*PORT\s*=\s*(.+)$') {
            $parsedPort = $Matches[1].Trim()
            $parsedPort = $parsedPort -replace '^["'']|["'']$'
            if ([int]::TryParse($parsedPort, [ref]$null)) {
                $AppPort = $parsedPort
            }
        }
    }
}

# Ensure log directory exists
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

function Write-Log {
    param([string]$msg)
    $ts = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    "$ts  $msg" | Add-Content -Path $LogFile -Encoding UTF8
}

function Write-Step {
    param([string]$n, [string]$msg)
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
    Write-Log "STEP $n : $msg"
}

function Write-Ok {
    param([string]$msg)
    Write-Host "    OK  $msg" -ForegroundColor Green
    Write-Log "   OK  $msg"
}

function Write-Warn {
    param([string]$msg)
    Write-Host "    WARN  $msg" -ForegroundColor Yellow
    Write-Log "   WARN  $msg"
}

function Rollback-Changes {
    Write-Log "--- ROLLBACK STARTED ---"
    Set-Location $InstallDir

    # 1. Restore git to the commit before this deploy
    Write-Host "    Resetting git to previous commit..." -ForegroundColor DarkGray
    git reset --hard HEAD@{1} 2>&1 | Out-Null

    # 2. Restore dist backup if it exists (avoids needing to rebuild)
    $backendDistBackup  = Join-Path $BackupDir "backend-dist"
    $frontendDistBackup = Join-Path $BackupDir "frontend-dist"

    if (Test-Path $backendDistBackup) {
        Write-Host "    Restoring backend dist from backup..." -ForegroundColor DarkGray
        $backendDist = Join-Path $InstallDir "backend\dist"
        if (Test-Path $backendDist) { Remove-Item $backendDist -Recurse -Force }
        Copy-Item $backendDistBackup $backendDist -Recurse -Force
        Write-Log "   Restored backend dist from backup"
    }
    if (Test-Path $frontendDistBackup) {
        Write-Host "    Restoring frontend dist from backup..." -ForegroundColor DarkGray
        $frontendDist = Join-Path $InstallDir "frontend\dist"
        if (Test-Path $frontendDist) { Remove-Item $frontendDist -Recurse -Force }
        Copy-Item $frontendDistBackup $frontendDist -Recurse -Force
        Write-Log "   Restored frontend dist from backup"
    }

    # 3. Restart PM2 with restored (previous) build
    Write-Host "    Restarting PM2 with previous stable build..." -ForegroundColor DarkGray
    pm2 restart grievance-backend grievance-frontend 2>&1 | Out-Null
    Write-Ok "Rollback complete. Application is running the previous stable version."
    Write-Log "--- ROLLBACK DONE ---"
}

function Write-Fail {
    param([string]$msg)
    Write-Host ""
    Write-Host "    FAILED: $msg" -ForegroundColor Red
    Write-Host "    Rolling back to previous stable state..." -ForegroundColor Red
    Write-Log "FAIL: $msg"
    Rollback-Changes
    Write-Log "=== DEPLOY FAILED - ROLLED BACK ==="
    # Only prompt for input when running interactively in a terminal.
    # When spawned by the backend API there is no console, so skip Read-Host
    # to prevent the process hanging forever.
    if ($IsInteractive) {
        Read-Host "Press Enter to close"
    }
    exit 1
}

# ── Pre-flight check ──────────────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
    Write-Host "Installation directory not found: $InstallDir" -ForegroundColor Red
    Write-Host "Please run install.bat first." -ForegroundColor Red
    Write-Log "FAIL: InstallDir not found at $InstallDir"
    exit 1
}

Write-Log "=== DEPLOY STARTED  interactive=$IsInteractive ==="

# ── STEP 1: Git Pull ──────────────────────────────────────────────────────────
Write-Step "1" "Pulling latest code from GitHub (main branch)"

Set-Location $InstallDir

# Backup .env (local secrets — never committed to git)
$envBackup = $null
$envPath   = Join-Path $InstallDir "backend\.env"
if (Test-Path $envPath) {
    $envBackup = Get-Content $envPath -Raw
}

# Save current commit info for potential rollback logging
$prevCommit = (git rev-parse HEAD 2>&1)
$prevMsg    = (git log -1 --format="%s" 2>&1)
Write-Log "   Previous commit: $prevCommit  ($prevMsg)"

$ErrorActionPreference = "Continue"

Write-Host "    Fetching from GitHub..." -ForegroundColor DarkGray
git fetch origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to fetch from GitHub. Check network connectivity or SSH key." }

Write-Host "    Resetting to origin/main..." -ForegroundColor DarkGray
git reset --hard origin/main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to reset to origin/main." }

$ErrorActionPreference = "Stop"

$newCommit = (git rev-parse HEAD 2>&1)
$newMsg    = (git log -1 --format="%s" 2>&1)
Write-Log "   New commit: $newCommit  ($newMsg)"

# Restore .env so secrets are not overwritten by git reset
if ($null -ne $envBackup) {
    $envBackup | Set-Content $envPath -NoNewline -Encoding UTF8
    Write-Ok "Latest code pulled. backend\.env preserved."
} else {
    Write-Ok "Latest code pulled."
}

if ($prevCommit -eq $newCommit) {
    Write-Warn "No new commits since last deploy. Code is already up to date. Proceeding with rebuild anyway."
} else {
    Write-Ok "New commit: $newMsg"
}

# ── STEP 2: Backup existing dist folders ─────────────────────────────────────
Write-Step "2" "Backing up current dist folders (for rollback safety)"

$ErrorActionPreference = "Continue"

# Clear any previous backup so it does not grow stale
if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$backendDist  = Join-Path $InstallDir "backend\dist"
$frontendDist = Join-Path $InstallDir "frontend\dist"

if (Test-Path $backendDist) {
    Copy-Item $backendDist (Join-Path $BackupDir "backend-dist") -Recurse -Force
    Write-Ok "Backend dist backed up."
} else {
    Write-Warn "No backend dist to backup — this may be the first deploy."
}

if (Test-Path $frontendDist) {
    Copy-Item $frontendDist (Join-Path $BackupDir "frontend-dist") -Recurse -Force
    Write-Ok "Frontend dist backed up."
} else {
    Write-Warn "No frontend dist to backup — this may be the first deploy."
}

$ErrorActionPreference = "Stop"

# ── STEP 3: Ensure frontend .env for production ───────────────────────────────
$frontendEnvPath = Join-Path $InstallDir "frontend\.env"
@"
# Auto-generated by deploy.bat for production deployment
# Leave VITE_API_URL empty so the frontend uses relative /api/... URLs
VITE_API_URL=
"@ | Set-Content -Path $frontendEnvPath -Encoding UTF8
Write-Ok "frontend\.env configured (same-origin API, VITE_API_URL=)"

# ── STEP 4: Frontend Build ────────────────────────────────────────────────────
Write-Step "4" "Building Frontend (npm install + npm run build)"

Set-Location (Join-Path $InstallDir "frontend")
$ErrorActionPreference = "Continue"

Write-Host "    Installing frontend dependencies..." -ForegroundColor DarkGray
npm install --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend npm install failed." }

Write-Host "    Building for production..." -ForegroundColor DarkGray
$env:NODE_OPTIONS = "--max-old-space-size=4096"
npm run build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
    $env:NODE_OPTIONS = ""
    Write-Fail "Frontend build failed. Check build output above."
}
$env:NODE_OPTIONS = ""
Write-Ok "Frontend built successfully."

# ── STEP 5: Backend Build ─────────────────────────────────────────────────────
Write-Step "5" "Building Backend (npm install + prisma generate + tsc)"

Set-Location (Join-Path $InstallDir "backend")

Write-Host "    Installing backend dependencies..." -ForegroundColor DarkGray
npm install --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend npm install failed." }

Write-Host "    Generating Prisma client..." -ForegroundColor DarkGray
npx prisma generate 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma generate failed." }

Write-Host "    Compiling TypeScript..." -ForegroundColor DarkGray
$env:NODE_OPTIONS = "--max-old-space-size=4096"
npm run build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
    $env:NODE_OPTIONS = ""
    Write-Fail "Backend TypeScript build failed. Check compile errors above."
}
$env:NODE_OPTIONS = ""
Write-Ok "Backend built successfully."

# ── STEP 6: DB Migration ──────────────────────────────────────────────────────
Write-Step "6" "Applying Database Schema Changes (prisma db push)"

Set-Location (Join-Path $InstallDir "backend")
npx prisma db push --accept-data-loss 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma db push failed. Database schema NOT updated." }
Write-Ok "Database schema verified and updated."

$ErrorActionPreference = "Stop"

# ── STEP 7: Restart Application ───────────────────────────────────────────────
Write-Step "7" "Restarting Application via PM2"

Set-Location $InstallDir
$ErrorActionPreference = "Continue"

pm2 restart grievance-backend grievance-frontend 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to restart PM2 processes. Check: pm2 status" }

Write-Host "    Waiting 5s for service warm-up..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5

# ── STEP 8: Health Check ──────────────────────────────────────────────────────
Write-Step "8" "Health Check (up to 5 retries)"

$healthy = $false
$retries = 5
while ($retries -gt 0) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AppPort/api/health" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    $retries--
    if ($retries -gt 0) {
        Write-Host "    Not healthy yet. $retries retries remaining..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 5
    }
}

if (-not $healthy) {
    Write-Host ""
    Write-Host "    HEALTH CHECK FAILED after deployment!" -ForegroundColor Red
    Write-Host "    Automatically rolling back to last stable build..." -ForegroundColor Yellow
    Write-Log "HEALTH CHECK FAILED — initiating rollback"
    Rollback-Changes
    Write-Log "=== DEPLOY FAILED (health check) - ROLLED BACK ==="
    if ($IsInteractive) {
        Read-Host "Press Enter to close"
    }
    exit 1
}

# ── SUCCESS ───────────────────────────────────────────────────────────────────
Write-Ok "Health check passed. Application is live."
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "  Deployment Successful!" -ForegroundColor Green
Write-Host "  Commit  : $newMsg" -ForegroundColor Green
Write-Host "  Backend : http://localhost:$AppPort/api/health" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Log "=== DEPLOY SUCCESSFUL === commit=$newCommit"
