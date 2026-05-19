<# :
@echo off
setlocal disabledelayedexpansion
title Grievance Monitoring System - Deploy Update
color 0B

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ============================================================
echo   Grievance Monitoring System - Deploy Update
echo   Haryana Police Headquarters
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -Encoding UTF8 '%~f0') -join [Environment]::NewLine)"

echo.
echo ========================================================
echo   Script finished. Press any key to close.
echo ========================================================
pause >nul
exit /b 0
#>

# ==============================================================================
# Deploy Update Script
# 1. Pull latest code from GitHub
# 2. Build backend and frontend
# 3. If build fails, rollback using git stash or git reset and restart
# ==============================================================================

$ErrorActionPreference = "Stop"

$InstallDir = "C:\PHQ-Dashboard"
$AppPort = 3001

function Write-Step {
    param([string]$n, [string]$msg)
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$msg)
    Write-Host "    OK  $msg" -ForegroundColor Green
}

function Write-Fail {
    param([string]$msg)
    Write-Host ""
    Write-Host "    FAILED: $msg" -ForegroundColor Red
    Write-Host "    Rolling back to previous state..." -ForegroundColor Red
    Rollback-Changes
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

function Rollback-Changes {
    Set-Location $InstallDir
    Write-Host "    Resetting git to previous commit..." -ForegroundColor DarkGray
    git reset --hard HEAD@{1} 2>&1 | Out-Null
    
    Write-Host "    Restarting PM2 service with previous build..." -ForegroundColor DarkGray
    pm2 restart grievance-monitor 2>&1 | Out-Null
    Write-Ok "Rollback complete. App should be running the previous version."
}

if (-not (Test-Path $InstallDir)) {
    Write-Host "Installation directory not found. Please run install.bat first." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# ── STEP 1: Git Pull ──────────────────────────────────────────────────────────
Write-Step "1" "Pulling latest code"

Set-Location $InstallDir

# Save current commit hash for potential rollback
$prevCommit = (git rev-parse HEAD)

Write-Host "    Fetching latest code from main branch..." -ForegroundColor DarkGray
$ErrorActionPreference = "Continue"
git fetch origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to fetch from GitHub." }

git reset --hard origin/main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to merge changes." }
$ErrorActionPreference = "Stop"

Write-Ok "Latest code pulled."

# ── STEP 2: Backend Build ─────────────────────────────────────────────────────
Write-Step "2" "Building Backend"

Set-Location (Join-Path $InstallDir "backend")
$ErrorActionPreference = "Continue"

Write-Host "    Installing dependencies..." -ForegroundColor DarkGray
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
    Write-Fail "Backend TypeScript build failed." 
}
$env:NODE_OPTIONS = ""
Write-Ok "Backend built."

# ── STEP 3: Frontend Build ────────────────────────────────────────────────────
Write-Step "3" "Building Frontend"

Set-Location (Join-Path $InstallDir "frontend")

Write-Host "    Installing dependencies..." -ForegroundColor DarkGray
npm install --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend npm install failed." }

Write-Host "    Building for production..." -ForegroundColor DarkGray
$env:NODE_OPTIONS = "--max-old-space-size=4096"
npm run build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { 
    $env:NODE_OPTIONS = ""
    Write-Fail "Frontend build failed." 
}
$env:NODE_OPTIONS = ""
Write-Ok "Frontend built."

# ── STEP 4: DB Migration ──────────────────────────────────────────────────────
Write-Step "4" "Applying Database Changes"

Set-Location (Join-Path $InstallDir "backend")
npx prisma db push --accept-data-loss 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma db push failed." }
Write-Ok "Database schema verified/updated."

$ErrorActionPreference = "Stop"

# ── STEP 5: Restart Application ───────────────────────────────────────────────
Write-Step "5" "Restarting App via PM2"

Set-Location $InstallDir
$ErrorActionPreference = "Continue"

pm2 restart grievance-monitor 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to restart PM2 service." }

Write-Host "    Waiting for service to warm up..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5

$healthy = $false
$retries = 3
while ($retries -gt 0) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AppPort/api/health" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    $retries--
    Start-Sleep -Seconds 5
}

if (-not $healthy) {
    Write-Host "  WARNING: Health check failed after deployment." -ForegroundColor Yellow
    Write-Host "  Rolling back to previous state..." -ForegroundColor Red
    Rollback-Changes
} else {
    Write-Ok "Deployment Successful! Service is healthy."
}
