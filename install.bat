<# :
@echo off
setlocal disabledelayedexpansion
title PHQ Complaint Dashboard - Automated Installation
color 0A

:: Self-Elevate to Administrator if not already running as Admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Run PowerShell block embedded in this file
echo Starting automated installation process...
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content '%~f0') -join [Environment]::NewLine)"

echo.
echo ========================================================
echo   Script finished. Press any key to close the window.
echo ========================================================
pause >nul
exit /b %errorLevel%
#>

# ==============================================================================
# PHQ Complaint Dashboard — Full Automated Windows Server Installer
# ==============================================================================
$ErrorActionPreference = "Stop"

$RepoUrl    = "https://github.com/jimmysh2/phq-complaint-dashboard-migrated.git"
$InstallDir = "C:\phq-dashboard"

# ─── Helper Functions ─────────────────────────────────────────────────────────
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
    Write-Host "    Installation aborted. Fix the error and re-run install.bat" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

function Find-CommandPath {
    param([string]$Name)
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    return $null
}

function Add-ToPath {
    param([string]$Dir)
    if (Test-Path $Dir) {
        if ($env:Path -notlike "*$Dir*") {
            $env:Path = $env:Path + ";" + $Dir
            [Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::Machine)
        }
    }
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# ─── Header ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "   PHQ Complaint Dashboard — Automated Windows Server Setup " -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

# ─── STEP 1: Interactive Configuration ────────────────────────────────────────
Write-Step "1" "Configuration Setup"
Write-Host ""

$Branch = Read-Host "  Git branch to deploy? (Leave blank = master)"
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = "master" }

$secure     = Read-Host "  PostgreSQL password for 'postgres' user? (Leave blank = Admin2026)" -AsSecureString
$bstr       = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ([string]::IsNullOrWhiteSpace($DbPassword)) { $DbPassword = "Admin2026" }

$AppPort = Read-Host "  Backend app port? (Leave blank = 3001)"
if ([string]::IsNullOrWhiteSpace($AppPort)) { $AppPort = "3001" }

$JwtSecret = Read-Host "  JWT secret key? (Leave blank = use default)"
if ([string]::IsNullOrWhiteSpace($JwtSecret)) { $JwtSecret = "phq-dashboard-secret-key-2024" }

$CctnsKey = Read-Host "  CCTNS Secret Key? (Leave blank = UserHryDashboard)"
if ([string]::IsNullOrWhiteSpace($CctnsKey)) { $CctnsKey = "UserHryDashboard" }

Write-Ok "Configuration saved."

# ─── STEP 2: Node.js ──────────────────────────────────────────────────────────
Write-Step "2" "Checking Node.js (v20 LTS required)"

Add-ToPath "C:\Program Files\nodejs"
Add-ToPath "$env:APPDATA\npm"
Refresh-Path

if (-not (Find-CommandPath "node")) {
    Write-Host "    Downloading Node.js v20 LTS..." -ForegroundColor DarkGray
    $nodeMsi = "$env:TEMP\node.msi"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://nodejs.org/dist/v20.19.1/node-v20.19.1-x64.msi", $nodeMsi)
    } catch { Write-Fail "Could not download Node.js. Check internet connection." }

    Write-Host "    Installing Node.js (this may take 1-2 min)..." -ForegroundColor DarkGray
    $proc = Start-Process "msiexec.exe" -ArgumentList "/i `"$nodeMsi`" /qn /norestart ADDLOCAL=ALL" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Node.js installer failed (exit code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\nodejs"
    Add-ToPath "$env:APPDATA\npm"
    if (-not (Find-CommandPath "node")) { Write-Fail "Node.js installed but 'node' not found in PATH. Reboot and re-run." }
}
Write-Ok "Node.js: $(& node --version 2>&1)"

# ─── STEP 3: Git ──────────────────────────────────────────────────────────────
Write-Step "3" "Checking Git"

Add-ToPath "C:\Program Files\Git\cmd"
Refresh-Path

if (-not (Find-CommandPath "git")) {
    Write-Host "    Downloading Git for Windows..." -ForegroundColor DarkGray
    $gitExe = "$env:TEMP\git-installer.exe"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe", $gitExe)
    } catch { Write-Fail "Could not download Git. Check internet connection." }

    Write-Host "    Installing Git (silent)..." -ForegroundColor DarkGray
    $proc = Start-Process $gitExe -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /COMPONENTS=icons,ext\reg\shellhere,assoc,assoc_sh" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "Git installer failed (exit code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\Git\cmd"
    if (-not (Find-CommandPath "git")) { Write-Fail "Git installed but not found in PATH. Reboot and re-run." }
}
Write-Ok "Git: $(& git --version 2>&1)"

# ─── STEP 4: PostgreSQL ───────────────────────────────────────────────────────
Write-Step "4" "Checking PostgreSQL 15"

Add-ToPath "C:\Program Files\PostgreSQL\15\bin"
Refresh-Path

if (-not (Find-CommandPath "psql")) {
    Write-Host "    Downloading PostgreSQL 15 (this may take a few minutes)..." -ForegroundColor DarkGray
    $pgExe = "$env:TEMP\postgres-installer.exe"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://get.enterprisedb.com/postgresql/postgresql-15.6-1-windows-x64.exe", $pgExe)
    } catch { Write-Fail "Could not download PostgreSQL. Check internet connection." }

    Write-Host "    Installing PostgreSQL (unattended, 3-5 min)..." -ForegroundColor DarkGray
    $pgArgs = "--mode unattended --unattendedmodeui none " +
              "--superpassword `"$DbPassword`" " +
              "--servicename postgresql-x64-15 " +
              "--servicepassword `"$DbPassword`" " +
              "--serverport 5432 " +
              "--datadir `"C:\Program Files\PostgreSQL\15\data`""
    $proc = Start-Process $pgExe -ArgumentList $pgArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Fail "PostgreSQL installer failed (exit code $($proc.ExitCode))." }

    Refresh-Path
    Add-ToPath "C:\Program Files\PostgreSQL\15\bin"
    if (-not (Find-CommandPath "psql")) { Write-Fail "PostgreSQL installed but 'psql' not found in PATH. Reboot and re-run." }
}
Write-Ok "PostgreSQL ready."

# ─── STEP 5: Clone / Update Repository ───────────────────────────────────────
Write-Step "5" "Setting up repository at $InstallDir"

if (Test-Path $InstallDir) {
    Write-Host "    $InstallDir already exists — pulling latest $Branch..." -ForegroundColor DarkGray
    Set-Location $InstallDir
    & git restore . 2>&1 | Out-Null
    & git fetch origin 2>&1 | Out-Null
    & git checkout $Branch 2>&1 | Out-Null
    & git pull origin $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "git pull failed. Check network and repo access." }
} else {
    Set-Location "C:\"
    Write-Host "    Cloning repository to $InstallDir..." -ForegroundColor DarkGray
    & git clone -b $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone failed. Check network and repo access." }
}
Set-Location $InstallDir
Write-Ok "Repository ready at $InstallDir (branch: $Branch)"

# ─── STEP 6: Create .env File ─────────────────────────────────────────────────
Write-Step "6" "Creating backend .env configuration"

$envExample = Join-Path $InstallDir "backend\.env.example"
$envTarget  = Join-Path $InstallDir "backend\.env"

if (-not (Test-Path $envExample)) {
    Write-Fail "backend\.env.example not found in repository. Cannot configure environment."
}

$envContent = Get-Content $envExample -Raw

# Build the local PostgreSQL connection string
$DbConnStr = "postgresql://postgres:$DbPassword@localhost:5432/phq_dashboard?schema=public"

# Replace placeholders in .env.example
$envContent = $envContent -replace 'DATABASE_URL=.*',    "DATABASE_URL=`"$DbConnStr`""
$envContent = $envContent -replace 'DIRECT_URL=.*',      "DIRECT_URL=`"$DbConnStr`""
$envContent = $envContent -replace 'JWT_SECRET=.*',      "JWT_SECRET=`"$JwtSecret`""
$envContent = $envContent -replace 'PORT=.*',            "PORT=$AppPort"
$envContent = $envContent -replace 'NODE_ENV=.*',        "NODE_ENV=production"
$envContent = $envContent -replace 'CCTNS_SECRET_KEY=.*', "CCTNS_SECRET_KEY=$CctnsKey"

Set-Content -Path $envTarget -Value $envContent -Encoding UTF8
Write-Ok ".env written to backend\.env"

# ─── STEP 7: Create PostgreSQL Database ───────────────────────────────────────
Write-Step "7" "Creating PostgreSQL database 'phq_dashboard'"

# Wait for PG service to be fully up
Start-Sleep -Seconds 3

$env:PGPASSWORD = $DbPassword
$dbCheck = & psql -U postgres -h localhost -p 5432 -tAc "SELECT 1 FROM pg_database WHERE datname='phq_dashboard';" 2>&1
if ("$dbCheck".Trim() -ne "1") {
    Write-Host "    Creating database..." -ForegroundColor DarkGray
    & psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE phq_dashboard;" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create database 'phq_dashboard'." }
    Write-Ok "Database 'phq_dashboard' created."
} else {
    Write-Ok "Database 'phq_dashboard' already exists — skipping creation."
}
$env:PGPASSWORD = ""

# ─── STEP 8: Install Dependencies & Build Backend ─────────────────────────────
Write-Step "8" "Installing dependencies and building backend"

Write-Host "    Installing PM2 globally..." -ForegroundColor DarkGray
& npm install -g pm2 pm2-windows-startup 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to install PM2 globally." }

Write-Host "    Installing backend npm packages..." -ForegroundColor DarkGray
Set-Location (Join-Path $InstallDir "backend")
& npm install --loglevel=error
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend npm install failed." }

Write-Host "    Generating Prisma client..." -ForegroundColor DarkGray
& npx prisma generate
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma generate failed." }

Write-Host "    Building TypeScript backend..." -ForegroundColor DarkGray
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend TypeScript build failed (npm run build)." }

Write-Ok "Backend built successfully."

# ─── STEP 9: Build Frontend ───────────────────────────────────────────────────
Write-Step "9" "Building frontend (React + Vite)"

Set-Location (Join-Path $InstallDir "frontend")
Write-Host "    Installing frontend npm packages..." -ForegroundColor DarkGray
& npm install --loglevel=error
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend npm install failed." }

Write-Host "    Building frontend for production..." -ForegroundColor DarkGray
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend build failed (npm run build)." }

Write-Ok "Frontend built to frontend\dist"

# ─── STEP 10: Apply Prisma Schema to Database ─────────────────────────────────
Write-Step "10" "Applying Prisma schema to database (db push)"

Set-Location (Join-Path $InstallDir "backend")
& npx prisma db push --accept-data-loss
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma db push failed. Check DATABASE_URL in backend\.env." }
Write-Ok "Database schema applied."

# ─── STEP 11: Seed Admin & Master Data ───────────────────────────────────────
Write-Step "11" "Seeding admin account and master reference data"

Write-Host "    Creating default admin account (admin / admin123)..." -ForegroundColor DarkGray
& npx tsx create-admin.ts
if ($LASTEXITCODE -ne 0) { Write-Fail "Admin seed failed." }

Write-Host "    Seeding Haryana master data (districts, PS, offices)..." -ForegroundColor DarkGray
& node scripts/seed-master-data.js
# Non-fatal: master data may already exist or be synced via CCTNS

Write-Ok "Admin and master data seeded."

# ─── STEP 12: Create PM2 Ecosystem Config ────────────────────────────────────
Write-Step "12" "Creating PM2 ecosystem config"

$ecosystemPath = Join-Path $InstallDir "ecosystem.config.cjs"
$ecosystemContent = @"
module.exports = {
  apps: [
    {
      name        : 'phq-dashboard',
      script      : 'backend/dist/index.js',
      cwd         : '$($InstallDir -replace '\\', '/')',
      instances   : 1,
      autorestart : true,
      watch       : false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV : 'production',
        PORT     : '$AppPort'
      },
      error_file  : 'logs/err.log',
      out_file    : 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
"@
Set-Content -Path $ecosystemPath -Value $ecosystemContent -Encoding UTF8
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null
Write-Ok "ecosystem.config.cjs created at $InstallDir"

# ─── STEP 13: Start App with PM2 ─────────────────────────────────────────────
Write-Step "13" "Starting PHQ Dashboard with PM2"

Set-Location $InstallDir
$ErrorActionPreference = "Continue"
& pm2 delete phq-dashboard 2>&1 | Out-Null
$ErrorActionPreference = "Stop"

& pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) { Write-Fail "PM2 failed to start the application." }
& pm2 save 2>&1 | Out-Null

Write-Host "    Configuring PM2 to auto-start on Windows boot..." -ForegroundColor DarkGray
& pm2-startup install 2>&1 | Out-Null
Write-Ok "PM2 running and boot-persistence configured."

# ─── STEP 14: Health Check ────────────────────────────────────────────────────
Write-Step "14" "Health check (waiting 15 seconds for app to warm up)"

Start-Sleep -Seconds 15

$healthy = $false
for ($i = 5; $i -gt 0; $i--) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AppPort/api/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Write-Host "    Not ready yet — retrying ($i attempts left)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
}

if (-not $healthy) {
    Write-Host ""
    Write-Host "  WARNING: Health check failed after retries." -ForegroundColor Yellow
    Write-Host "  The app may still be starting. Check logs with:" -ForegroundColor Yellow
    Write-Host "    pm2 logs phq-dashboard" -ForegroundColor Yellow
} else {
    Write-Ok "Application is healthy at http://localhost:$AppPort/api/health"
}

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "              INSTALLATION COMPLETE!                        " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard URL  : http://localhost:$AppPort"
Write-Host "  Default Login  : admin / admin123"
Write-Host "  Install Dir    : $InstallDir"
Write-Host "  Branch         : $Branch"
Write-Host ""
Write-Host "  Useful Commands:"
Write-Host "    pm2 status              — see running processes"
Write-Host "    pm2 logs phq-dashboard  — live logs"
Write-Host "    pm2 restart phq-dashboard — restart app"
Write-Host ""
Write-Host "  For future updates, run: deploy.bat"
Write-Host ""
Read-Host "Press Enter to close"
