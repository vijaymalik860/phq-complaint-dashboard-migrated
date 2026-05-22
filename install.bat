<# :
@echo off
setlocal disabledelayedexpansion
title Grievance Monitoring System - Automated Installation
color 0A

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ============================================================
echo   Grievance Monitoring System - Automated Setup
echo   Haryana Police Headquarters
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -Encoding UTF8 '%~f0') -join [Environment]::NewLine)"

exit /b 0
#>

# ==============================================================================
# Grievance Monitoring System - Full Automated Windows Server Installer
# ==============================================================================
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoUrl      = "https://github.com/jimmysh2/phq-complaint-dashboard-migrated.git"
$InstallDir   = "C:\PHQ-Dashboard"
$FrontendPort = "5173"

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
    Write-Host "    Fix the issue and re-run install.bat" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

function Find-Cmd {
    param([string]$Name)
    return ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue))
}

function Add-ToPath {
    param([string]$Dir)
    if ((Test-Path $Dir) -and ($env:Path -notlike "*$Dir*")) {
        $env:Path = "$env:Path;$Dir"
        [Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::Machine)
    }
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  Grievance Monitoring System - Automated Setup             " -ForegroundColor Magenta
Write-Host "  Haryana Police Headquarters                               " -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

# ── STEP 1: Configuration ─────────────────────────────────────────────────────
Write-Step "1" "Configuration Setup"
Write-Host ""
Write-Host "  Press Enter on any question to accept the default value." -ForegroundColor DarkGray
Write-Host ""

$Branch = Read-Host "  Git branch to deploy? (default: main)"
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = "main" }

$secure = Read-Host "  PostgreSQL password for new install? (default: Admin2026)" -AsSecureString
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$DbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ([string]::IsNullOrWhiteSpace($DbPass)) { $DbPass = "Admin2026" }

$DbPort = Read-Host "  PostgreSQL port? (default: 5432)"
if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort = "5432" }

$AppPort = Read-Host "  Backend app port? (default: 3001)"
if ([string]::IsNullOrWhiteSpace($AppPort)) { $AppPort = "3001" }

# ── Fixed secrets — not prompted, always written as-is ───────────────────────
$JwtSecret    = "phq-dashboard-secret-key-2024"
$CronSecret   = "sec_a9d3e7b1f4c62"
$CctnsSecret  = "UserHryDashboard"
$CctnsDecrypt = "O7yhrqWMMymKrM9Av64JkXo3GOoTebAyJlQ9diSxi0U="

Write-Ok "Configuration saved."
Write-Host "    (JWT, Cron, CCTNS keys are fixed defaults — not prompted)" -ForegroundColor DarkGray

# ── STEP 2: Node.js ───────────────────────────────────────────────────────────
Write-Step "2" "Checking Node.js v20 LTS"

Add-ToPath "C:\Program Files\nodejs"
Add-ToPath "$env:APPDATA\npm"
Refresh-Path

if (-not (Find-Cmd "node")) {
    Write-Host "    Downloading Node.js v20 LTS..." -ForegroundColor DarkGray
    $nodeMsi = "$env:TEMP\node.msi"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://nodejs.org/dist/v20.19.1/node-v20.19.1-x64.msi", $nodeMsi)
    } catch { Write-Fail "Could not download Node.js. Check internet connection." }

    Write-Host "    Installing Node.js (silent, ~2 min)..." -ForegroundColor DarkGray
    $proc = Start-Process "msiexec.exe" `
        -ArgumentList "/i `"$nodeMsi`" /qn /norestart ADDLOCAL=ALL" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Node.js installer failed (code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\nodejs"
    Add-ToPath "$env:APPDATA\npm"
    if (-not (Find-Cmd "node")) {
        Write-Fail "Node.js installed but not found in PATH. Reboot and re-run."
    }
}
Write-Ok "Node.js: $(node --version 2>&1)"

# ── STEP 3: Git ───────────────────────────────────────────────────────────────
Write-Step "3" "Checking Git"

Add-ToPath "C:\Program Files\Git\cmd"
Refresh-Path

if (-not (Find-Cmd "git")) {
    Write-Host "    Downloading Git for Windows..." -ForegroundColor DarkGray
    $gitExe = "$env:TEMP\git-installer.exe"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe",
            $gitExe)
    } catch { Write-Fail "Could not download Git. Check internet connection." }

    Write-Host "    Installing Git (silent)..." -ForegroundColor DarkGray
    $proc = Start-Process $gitExe `
        -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS" `
        -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Git installer failed (code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\Git\cmd"
    if (-not (Find-Cmd "git")) {
        Write-Fail "Git installed but not found in PATH. Reboot and re-run."
    }
}
Write-Ok "Git: $(git --version 2>&1)"

# ── STEP 4: PostgreSQL ────────────────────────────────────────────────────────
Write-Step "4" "Checking PostgreSQL"

# Scan all common PostgreSQL install paths (PG 14-18)
$pgVersions  = @('18', '17', '16', '15', '14')
$pgFoundPath = $null
$pgFoundVer  = $null

foreach ($ver in $pgVersions) {
    $candidate = "C:\Program Files\PostgreSQL\$ver\bin"
    if (Test-Path (Join-Path $candidate "psql.exe")) {
        $pgFoundPath = $candidate
        $pgFoundVer  = $ver
        break
    }
}

# Also check if psql already exists in PATH
Add-ToPath "C:\Program Files\PostgreSQL\15\bin"
Refresh-Path
if ($null -eq $pgFoundPath -and (Find-Cmd "psql")) {
    $pgFoundPath = (Split-Path (Get-Command psql).Source)
    $pgFoundVer  = "existing"
}

$doFreshInstall = $false

if ($null -ne $pgFoundPath) {
    # ── PostgreSQL already on this machine ──
    Write-Host ""
    Write-Host "  PostgreSQL found at: $pgFoundPath" -ForegroundColor Yellow
    Write-Host ""
    $useExisting = Read-Host "  PostgreSQL is already installed. Use existing? [Y/n]"

    if ([string]::IsNullOrWhiteSpace($useExisting) -or $useExisting -match '^[Yy]') {
        Write-Host ""
        $sec2   = Read-Host "  Enter password for existing PostgreSQL 'postgres' user" -AsSecureString
        $bstr2  = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
        $DbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
        if ([string]::IsNullOrWhiteSpace($DbPass)) { $DbPass = "Admin2026" }

        $pgPortInput = Read-Host "  Existing PostgreSQL port? (default: $DbPort)"
        if (-not [string]::IsNullOrWhiteSpace($pgPortInput)) { $DbPort = $pgPortInput }

        Add-ToPath $pgFoundPath
        Refresh-Path
        Write-Ok "Using existing PostgreSQL v$pgFoundVer"
    } else {
        Write-Host ""
        Write-Host "  WARNING: Installing PostgreSQL 15 over an existing version may fail." -ForegroundColor Yellow
        Write-Host "  Recommended: uninstall the current PostgreSQL first, then re-run." -ForegroundColor Yellow
        Write-Host ""
        $confirm = Read-Host "  Proceed with fresh install anyway? [y/N]"
        if ($confirm -match '^[Yy]') {
            $doFreshInstall = $true
        } else {
            Write-Fail "Cancelled. Uninstall existing PostgreSQL and re-run install.bat."
        }
    }
} else {
    $doFreshInstall = $true
}

if ($doFreshInstall) {
    Write-Host "    Downloading PostgreSQL 15..." -ForegroundColor DarkGray
    $pgExe = "$env:TEMP\postgres-installer.exe"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://get.enterprisedb.com/postgresql/postgresql-15.6-1-windows-x64.exe", $pgExe)
    } catch { Write-Fail "Could not download PostgreSQL. Check internet connection." }

    Write-Host "    Installing PostgreSQL 15 (unattended, 3-5 min)..." -ForegroundColor DarkGray
    $pgArgs = "--mode unattended --unattendedmodeui none " +
              "--superpassword `"$DbPass`" " +
              "--servicename postgresql-x64-15 " +
              "--servicepassword `"$DbPass`" " +
              "--serverport $DbPort " +
              "--datadir `"C:\Program Files\PostgreSQL\15\data`""
    $proc = Start-Process $pgExe -ArgumentList $pgArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "PostgreSQL installer failed (code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\PostgreSQL\15\bin"
    if (-not (Find-Cmd "psql")) {
        Write-Fail "PostgreSQL installed but psql not in PATH. Reboot and re-run."
    }
    Write-Ok "PostgreSQL 15 installed."
}

# ── STEP 5: Clone Repository ──────────────────────────────────────────────────
Write-Step "5" "Setting up repository at $InstallDir"

if (Test-Path $InstallDir) {
    # Check if the directory is actually a git repo
    Set-Location $InstallDir
    $ErrorActionPreference = "Continue"
    git rev-parse --git-dir 2>&1 | Out-Null
    $isGitRepo = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"

    if ($isGitRepo) {
        Write-Host "    Git repo found. Pulling latest $Branch..." -ForegroundColor DarkGray
        git restore . 2>&1 | Out-Null
        git fetch origin 2>&1 | Out-Null
        git checkout $Branch 2>&1 | Out-Null
        git pull origin $Branch 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "git pull failed. Check internet or repo access." }
    } else {
        Write-Host "    Folder exists but is not a git repo. Removing and cloning fresh..." -ForegroundColor Yellow
        Set-Location "C:\"
        Remove-Item -Recurse -Force $InstallDir
        git clone -b $Branch $RepoUrl $InstallDir
        if ($LASTEXITCODE -ne 0) { Write-Fail "git clone failed. Check internet or repo access." }
    }
} else {
    Set-Location "C:\"
    Write-Host "    Cloning repository..." -ForegroundColor DarkGray
    git clone -b $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone failed. Check internet or repo access." }
}
Set-Location $InstallDir
Write-Ok "Repository ready at $InstallDir"

# ── STEP 6: Write backend\.env ────────────────────────────────────────────────
Write-Step "6" "Writing backend\.env from your configuration inputs"

# URL-encode the DB password so special chars (@, #, !, spaces, etc.) are safe
$DbPassEncoded = [Uri]::EscapeDataString($DbPass)
$DbUrl         = "postgresql://postgres:{0}@localhost:{1}/phq_dashboard?schema=public" -f $DbPassEncoded, $DbPort
$envTarget     = Join-Path $InstallDir "backend\.env"

# Build every line explicitly — no dependency on .env.example template.
# Using -f operator avoids PowerShell variable-expansion issues with special chars.
$backendEnvLines = @(
    "# ============================================================",
    "# PHQ Dashboard Backend - Environment Variables",
    ("# Auto-generated by install.bat  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
    "# ============================================================",
    "",
    "# PostgreSQL Connection",
    ('DATABASE_URL="{0}"' -f $DbUrl),
    ('DIRECT_URL="{0}"'   -f $DbUrl),
    "",
    "# Server",
    ("PORT={0}"           -f $AppPort),
    "NODE_ENV=production",
    "",
    "# Security",
    ('JWT_SECRET="{0}"'   -f $JwtSecret),
    ("CRON_SECRET={0}"    -f $CronSecret),
    "",
    "# CCTNS Haryana Police API",
    ("CCTNS_SECRET_KEY={0}"   -f $CctnsSecret),
    ("CCTNS_DECRYPT_KEY={0}"  -f $CctnsDecrypt),
    "CCTNS_TOKEN_API=http://api.haryanapolice.gov.in/cmDashboard/api/HomeDashboard/ReqToken",
    "CCTNS_COMPLAINT_API=http://api.haryanapolice.gov.in/phqdashboard/api/PHQDashboard/ComplaintData"
)

# Write UTF-8 WITHOUT BOM — dotenv / Node.js can misparse files that have a BOM
[System.IO.File]::WriteAllLines($envTarget, $backendEnvLines, (New-Object System.Text.UTF8Encoding $false))

# ── Post-write verification ───────────────────────────────────────────────────
if (-not (Test-Path $envTarget)) {
    Write-Fail "backend\.env was not created. Check disk write permissions on $InstallDir."
}

$writtenContent = Get-Content $envTarget -Raw
$requiredKeys   = @('DATABASE_URL', 'DIRECT_URL', 'PORT', 'NODE_ENV',
                    'JWT_SECRET', 'CRON_SECRET',
                    'CCTNS_SECRET_KEY', 'CCTNS_DECRYPT_KEY',
                    'CCTNS_TOKEN_API', 'CCTNS_COMPLAINT_API')
$missingKeys = @()
foreach ($key in $requiredKeys) {
    if ($writtenContent -notmatch "(?m)^$key=") { $missingKeys += $key }
}
if ($missingKeys.Count -gt 0) {
    Write-Fail ("backend\.env is missing required keys: {0}" -f ($missingKeys -join ', '))
}

$lineCount = ($writtenContent -split "`n").Count
Write-Ok ("backend\.env written and verified — {0} lines, all {1} keys present" -f $lineCount, $requiredKeys.Count)
Write-Host ""
Write-Host "    Written values:" -ForegroundColor DarkGray
Write-Host ("      DATABASE_URL        = postgresql://postgres:***@localhost:{0}/phq_dashboard" -f $DbPort) -ForegroundColor DarkGray
Write-Host  "      DIRECT_URL          = (same as DATABASE_URL)"  -ForegroundColor DarkGray
Write-Host ("      PORT                = {0}"    -f $AppPort)     -ForegroundColor DarkGray
Write-Host  "      NODE_ENV            = production"              -ForegroundColor DarkGray
Write-Host  "      JWT_SECRET          = [set]"                   -ForegroundColor DarkGray
Write-Host  "      CRON_SECRET         = [set]"                   -ForegroundColor DarkGray
Write-Host ("      CCTNS_SECRET_KEY    = {0}"    -f $CctnsSecret) -ForegroundColor DarkGray
Write-Host  "      CCTNS_DECRYPT_KEY   = [set]"                   -ForegroundColor DarkGray
Write-Host  "      CCTNS_TOKEN_API     = [Haryana Police default]" -ForegroundColor DarkGray
Write-Host  "      CCTNS_COMPLAINT_API = [Haryana Police default]" -ForegroundColor DarkGray

# ── STEP 6b: Write frontend\.env ──────────────────────────────────────────────
$frontendEnvTarget = Join-Path $InstallDir "frontend\.env"
$frontendEnvLines  = @(
    "# PHQ Dashboard Frontend - Environment Variables",
    ("# Auto-generated by install.bat  {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
    "",
    "# Backend API base URL — must match the PORT set above",
    ("VITE_API_URL=http://localhost:{0}" -f $AppPort),
    "",
    "# App display title",
    "VITE_APP_TITLE=PHQ Complaint Dashboard"
)

[System.IO.File]::WriteAllLines($frontendEnvTarget, $frontendEnvLines, (New-Object System.Text.UTF8Encoding $false))

if (-not (Test-Path $frontendEnvTarget)) {
    Write-Fail "frontend\.env was not created. Check disk write permissions."
}
if ((Get-Content $frontendEnvTarget -Raw) -notmatch '(?m)^VITE_API_URL=') {
    Write-Fail "frontend\.env was written but VITE_API_URL is missing."
}

Write-Ok ("frontend\.env written (VITE_API_URL=http://localhost:{0}, VITE_APP_TITLE set)" -f $AppPort)

# ── STEP 7: Create Database ───────────────────────────────────────────────────
Write-Step "7" "Creating database phq_dashboard"

Start-Sleep -Seconds 3

# PGCONNECT_TIMEOUT works across all PG versions (14-18); --connect-timeout flag is not supported by PG18
$env:PGPASSWORD       = $DbPass
$env:PGCONNECT_TIMEOUT = "10"

$checkResult = psql -U postgres -h localhost -p $DbPort -tAc "SELECT 1 FROM pg_database WHERE datname='phq_dashboard';" 2>&1
if ($LASTEXITCODE -ne 0) {
    $env:PGPASSWORD       = ""
    $env:PGCONNECT_TIMEOUT = ""
    Write-Fail "Cannot connect to PostgreSQL at port $DbPort. Check password and that the service is running.`n    Error: $checkResult"
}
$dbExists = ("$checkResult".Trim() -eq "1")

if (-not $dbExists) {
    Write-Host "    Creating database..." -ForegroundColor DarkGray
    psql -U postgres -h localhost -p $DbPort -c "CREATE DATABASE phq_dashboard;" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create database phq_dashboard. Check PostgreSQL logs." }
    Write-Ok "Database phq_dashboard created."
} else {
    Write-Ok "Database phq_dashboard already exists."
}
$env:PGPASSWORD        = ""
$env:PGCONNECT_TIMEOUT = ""

# ── STEP 8: Install PM2 ───────────────────────────────────────────────────────
Write-Step "8" "Installing PM2 globally"

# npm always writes notices to stderr - must use Continue mode or they crash the script
$ErrorActionPreference = "Continue"

if (Find-Cmd "pm2") {
    $pm2Ver = (pm2 --version 2>&1 | Select-Object -First 1)
    Write-Ok "PM2 already installed (v$pm2Ver) - skipping."
} else {
    Write-Host "    Installing PM2 and pm2-windows-startup..." -ForegroundColor DarkGray
    npm install -g pm2 pm2-windows-startup 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $ErrorActionPreference = "Stop"
        Write-Fail "Failed to install PM2. Check internet and npm access."
    }
    Write-Ok "PM2 installed."
}

# Ensure pm2-windows-startup is present even if PM2 was pre-installed
npm list -g pm2-windows-startup 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "    Installing pm2-windows-startup..." -ForegroundColor DarkGray
    npm install -g pm2-windows-startup 2>&1 | Out-Null
}

$ErrorActionPreference = "Stop"

# ── STEP 9: Backend Build ─────────────────────────────────────────────────────
Write-Step "9" "Installing backend dependencies and building"

Set-Location (Join-Path $InstallDir "backend")

$ErrorActionPreference = "Continue"

Write-Host "    npm install (backend)..." -ForegroundColor DarkGray
npm install --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Backend npm install failed." }

Write-Host "    Generating Prisma client..." -ForegroundColor DarkGray
npx prisma generate 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Prisma generate failed." }

$env:NODE_OPTIONS = "--max-old-space-size=4096"
Write-Host "    Compiling TypeScript..." -ForegroundColor DarkGray
npm run build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Backend TypeScript build failed." }
$env:NODE_OPTIONS = ""

$ErrorActionPreference = "Stop"
Write-Ok "Backend built."

# ── STEP 10: Frontend Build ───────────────────────────────────────────────────
Write-Step "10" "Building frontend (React + Vite)"

Set-Location (Join-Path $InstallDir "frontend")

$ErrorActionPreference = "Continue"

Write-Host "    npm install (frontend)..." -ForegroundColor DarkGray
npm install --loglevel=error 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Frontend npm install failed." }

$env:NODE_OPTIONS = "--max-old-space-size=4096"
Write-Host "    Building for production..." -ForegroundColor DarkGray
npm run build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Frontend build failed." }
$env:NODE_OPTIONS = ""

$ErrorActionPreference = "Stop"
Write-Ok "Frontend built to frontend\dist"

# ── STEP 11: Prisma DB Push ───────────────────────────────────────────────────
Write-Step "11" "Applying database schema"

Set-Location (Join-Path $InstallDir "backend")

$ErrorActionPreference = "Continue"
npx prisma db push --accept-data-loss 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Prisma db push failed. Check DATABASE_URL in backend\.env." }
$ErrorActionPreference = "Stop"
Write-Ok "Database schema applied."

# ── STEP 12: Seed Data ────────────────────────────────────────────────────────
Write-Step "12" "Seeding admin account and master data"

$ErrorActionPreference = "Continue"

Write-Host "    Creating admin account (admin / admin123)..." -ForegroundColor DarkGray
npx tsx create-admin.ts 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "Admin seed script failed." }

Write-Host "    Seeding Haryana districts and police stations..." -ForegroundColor DarkGray
node scripts/seed-master-data.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
# Non-fatal - master data can also sync via CCTNS later

$ErrorActionPreference = "Stop"
Write-Ok "Admin and master data ready."

# ── STEP 13: PM2 Ecosystem Config ────────────────────────────────────────────
Write-Step "13" "Creating PM2 ecosystem config"

$ecosystemPath = Join-Path $InstallDir "ecosystem.config.cjs"
$cwd           = $InstallDir -replace '\\', '/'
$frontendCwd   = (Join-Path $InstallDir "frontend") -replace '\\', '/'

$ecosystem = @"
module.exports = {
  apps: [
    {
      name        : 'grievance-backend',
      script      : 'backend/dist/index.js',
      cwd         : '$cwd',
      instances   : 1,
      autorestart : true,
      watch       : false,
      env: {
        NODE_ENV : 'production',
        PORT     : '$AppPort'
      },
      error_file  : 'logs/backend-err.log',
      out_file    : 'logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name        : 'grievance-frontend',
      script      : 'node_modules/vite/bin/vite.js',
      args        : 'preview --port $FrontendPort --host 0.0.0.0',
      cwd         : '$frontendCwd',
      instances   : 1,
      autorestart : true,
      watch       : false,
      error_file  : '$cwd/logs/frontend-err.log',
      out_file    : '$cwd/logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
"@

$ecosystem | Set-Content -Path $ecosystemPath -Encoding UTF8
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null
Write-Ok "ecosystem.config.cjs created (backend + frontend)."

# ── STEP 14: Start with PM2 ───────────────────────────────────────────────────
Write-Step "14" "Starting backend and frontend with PM2"

Set-Location $InstallDir
$ErrorActionPreference = "Continue"

# Stop any existing instances gracefully (errors are expected if they weren't running)
pm2 delete grievance-backend  2>&1 | Out-Null
pm2 delete grievance-frontend 2>&1 | Out-Null
pm2 delete grievance-monitor  2>&1 | Out-Null   # cleanup old name if present

Write-Host "    Starting grievance-backend..." -ForegroundColor DarkGray
Write-Host "    Starting grievance-frontend..." -ForegroundColor DarkGray

# Suppress PM2's box-drawing table output (unreadable on Windows CMD)
pm2 start ecosystem.config.cjs 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Fail "PM2 failed to start the application." }

# Show a clean readable status instead of PM2's garbled table
$pm2List = pm2 jlist 2>&1
try {
    $pm2Apps = $pm2List | ConvertFrom-Json
    foreach ($app in $pm2Apps) {
        $appName   = $app.name
        $appStatus = $app.pm2_env.status
        $appPid    = $app.pid
        if ($appStatus -eq 'online') {
            Write-Host "    [OK]  $appName  -->  status: $appStatus  (pid: $appPid)" -ForegroundColor Green
        } else {
            Write-Host "    [!!]  $appName  -->  status: $appStatus  (pid: $appPid)" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "    (Could not parse PM2 status list)" -ForegroundColor Yellow
}

pm2 save 2>&1 | Out-Null

Write-Host "    Configuring PM2 auto-start on Windows boot..." -ForegroundColor DarkGray
pm2-startup install 2>&1 | Out-Null
$ErrorActionPreference = "Stop"
Write-Ok "PM2 running (both backend and frontend) with boot-persistence."

# ── STEP 15: Register PHQDeploy Scheduled Task (inline — no external .ps1 needed) ──
Write-Step "15" "Registering PHQDeploy Windows Scheduled Task (enables UI Update button)"

$DeployBat = Join-Path $InstallDir "deploy.bat"
try {
    $ErrorActionPreference = "Stop"
    $action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$DeployBat`"" -WorkingDirectory $InstallDir
    $farFuture = (Get-Date).AddYears(99)
    $trigger   = New-ScheduledTaskTrigger -Once -At $farFuture
    $settings  = New-ScheduledTaskSettingsSet `
                    -ExecutionTimeLimit      (New-TimeSpan -Hours 2) `
                    -MultipleInstances       IgnoreNew `
                    -AllowStartIfOnBatteries `
                    -DontStopIfGoingOnBatteries `
                    -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask `
        -TaskName    "PHQDeploy" `
        -TaskPath    "\" `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description "PHQ Dashboard UI-triggered deployment" `
        -Force `
        -ErrorAction Stop | Out-Null
    Write-Ok "PHQDeploy scheduled task registered. UI Update button is ready."
} catch {
    Write-Host "  WARNING: Scheduled task registration failed: $_" -ForegroundColor Yellow
    Write-Host "           The app will still run. Re-run install.bat as Administrator to enable the Update button." -ForegroundColor Yellow
    $ErrorActionPreference = "Continue"
}

# ── STEP 16: Health Check ─────────────────────────────────────────────────────
Write-Step "16" "Health checks (waiting 15 seconds for warm-up)"

Start-Sleep -Seconds 15

# --- Backend health check ---
$backendHealthy = $false
$retries = 5
while ($retries -gt 0) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AppPort/api/health" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $backendHealthy = $true; break }
    } catch {}
    $retries--
    Write-Host "    Backend not ready yet. Retrying ($retries left)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
}

if (-not $backendHealthy) {
    Write-Host ""
    Write-Host "  WARNING: Backend health check did not respond." -ForegroundColor Yellow
    Write-Host "  Check logs: pm2 logs grievance-backend" -ForegroundColor Yellow
} else {
    Write-Ok "Backend API is RUNNING at http://localhost:$AppPort/api"
}

# --- Frontend health check ---
$frontendHealthy = $false
$retries2 = 5
while ($retries2 -gt 0) {
    try {
        $resp2 = Invoke-WebRequest -Uri "http://localhost:$FrontendPort" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp2.StatusCode -eq 200) { $frontendHealthy = $true; break }
    } catch {}
    $retries2--
    Write-Host "    Frontend not ready yet. Retrying ($retries2 left)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

if (-not $frontendHealthy) {
    Write-Host ""
    Write-Host "  WARNING: Frontend did not respond on port $FrontendPort." -ForegroundColor Yellow
    Write-Host "  Check logs: pm2 logs grievance-frontend" -ForegroundColor Yellow
} else {
    Write-Ok "Frontend is RUNNING at http://localhost:$FrontendPort"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "              INSTALLATION COMPLETE!                            " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Application  : Grievance Monitoring System" -ForegroundColor White
Write-Host "  Department   : Haryana Police Headquarters" -ForegroundColor White
Write-Host ""
Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |  PORTAL URLs (both are running in the background)      |" -ForegroundColor Cyan
Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |                                                         |" -ForegroundColor Cyan
Write-Host "  |  >> FRONTEND  : http://localhost:$FrontendPort           |" -ForegroundColor Yellow
Write-Host "  |  >> BACKEND   : http://localhost:$AppPort             |" -ForegroundColor Yellow
Write-Host "  |  >> API       : http://localhost:$AppPort/api         |" -ForegroundColor Yellow
Write-Host "  |                                                         |" -ForegroundColor Cyan
Write-Host "  |  Login        : admin / admin123                        |" -ForegroundColor Green
Write-Host "  |  Database     : phq_dashboard @ localhost:$DbPort       |" -ForegroundColor White
Write-Host "  |  Install Dir  : $InstallDir                |" -ForegroundColor White
Write-Host "  |                                                         |" -ForegroundColor Cyan
Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Host "  NOTE: Both portals run via PM2 in the background." -ForegroundColor DarkGray
Write-Host "        Closing this window will NOT stop them." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor White
Write-Host "    pm2 status                      - check all running processes"
Write-Host "    pm2 logs grievance-backend      - view backend live logs"
Write-Host "    pm2 logs grievance-frontend     - view frontend live logs"
Write-Host "    pm2 restart grievance-backend   - restart backend"
Write-Host "    pm2 restart grievance-frontend  - restart frontend"
Write-Host ""
Write-Host "  For future updates run: deploy.bat"
Write-Host ""
Write-Host "  Both portals will automatically restart when Windows reboots." -ForegroundColor DarkGray
Write-Host ""

# ── Keep window open until user is ready ─────────────────────────────────────
# PM2 manages both processes independently; pressing a key here only
# closes this installer window - the portals keep running.
Write-Host "=================================================================" -ForegroundColor Magenta
Write-Host "  Press any key to close this installer window.                  " -ForegroundColor Magenta
Write-Host "  (The backend and frontend portals will keep running.)          " -ForegroundColor Magenta
Write-Host "=================================================================" -ForegroundColor Magenta
Write-Host ""
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
