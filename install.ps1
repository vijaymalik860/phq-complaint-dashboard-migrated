# ==============================================================================
# Grievance Monitoring System - Full Automated Windows Server Installer
# Haryana Police Headquarters
# Run via: install.bat (do NOT run this .ps1 directly)
# ==============================================================================
$ErrorActionPreference = "Stop"

$RepoUrl    = "https://github.com/jimmysh2/phq-complaint-dashboard-migrated.git"
$InstallDir = "C:\PHQ-Dashboard"

# Helper functions
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

# Header
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

$secure = Read-Host "  PostgreSQL password? (default: Admin2026)" -AsSecureString
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$DbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ([string]::IsNullOrWhiteSpace($DbPass)) { $DbPass = "Admin2026" }

$DbPort = Read-Host "  PostgreSQL port? (default: 5432)"
if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort = "5432" }

$AppPort = Read-Host "  Backend app port? (default: 3001)"
if ([string]::IsNullOrWhiteSpace($AppPort)) { $AppPort = "3001" }

Write-Ok "Configuration saved."

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
        Write-Fail "Node.js installed but not found in PATH. Reboot and re-run install.bat."
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
        Write-Fail "Git installed but not found in PATH. Reboot and re-run install.bat."
    }
}
Write-Ok "Git: $(git --version 2>&1)"

# ── STEP 4: PostgreSQL ────────────────────────────────────────────────────────
Write-Step "4" "Checking PostgreSQL 15"

Add-ToPath "C:\Program Files\PostgreSQL\15\bin"
Refresh-Path

if (-not (Find-Cmd "psql")) {
    Write-Host "    Downloading PostgreSQL 15 (may take a few minutes)..." -ForegroundColor DarkGray
    $pgExe = "$env:TEMP\postgres-installer.exe"
    try {
        (New-Object System.Net.WebClient).DownloadFile(
            "https://get.enterprisedb.com/postgresql/postgresql-15.6-1-windows-x64.exe", $pgExe)
    } catch { Write-Fail "Could not download PostgreSQL. Check internet connection." }

    Write-Host "    Installing PostgreSQL (unattended, 3-5 min)..." -ForegroundColor DarkGray
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
        Write-Fail "PostgreSQL installed but psql not in PATH. Reboot and re-run install.bat."
    }
}
Write-Ok "PostgreSQL ready."

# ── STEP 5: Clone Repository ──────────────────────────────────────────────────
Write-Step "5" "Setting up repository at $InstallDir"

if (Test-Path $InstallDir) {
    Write-Host "    Directory exists. Pulling latest $Branch..." -ForegroundColor DarkGray
    Set-Location $InstallDir
    git restore . 2>&1 | Out-Null
    git fetch origin 2>&1 | Out-Null
    git checkout $Branch 2>&1 | Out-Null
    git pull origin $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "git pull failed. Check internet or repo access." }
} else {
    Set-Location "C:\"
    Write-Host "    Cloning repository..." -ForegroundColor DarkGray
    git clone -b $Branch $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone failed. Check internet or repo access." }
}
Set-Location $InstallDir
Write-Ok "Repository ready at $InstallDir"

# ── STEP 6: Write .env File ───────────────────────────────────────────────────
Write-Step "6" "Creating backend\.env configuration"

$envExample = Join-Path $InstallDir "backend\.env.example"
$envTarget  = Join-Path $InstallDir "backend\.env"

if (-not (Test-Path $envExample)) {
    Write-Fail "backend\.env.example not found in repository."
}

$DbUrl = "postgresql://postgres:${DbPass}@localhost:${DbPort}/phq_dashboard?schema=public"
$envLines = Get-Content $envExample

$newLines = $envLines | ForEach-Object {
    if ($_ -match '^DATABASE_URL=')    { "DATABASE_URL=`"$DbUrl`"" }
    elseif ($_ -match '^DIRECT_URL=')  { "DIRECT_URL=`"$DbUrl`"" }
    elseif ($_ -match '^PORT=')        { "PORT=$AppPort" }
    elseif ($_ -match '^NODE_ENV=')    { "NODE_ENV=production" }
    else { $_ }
}

$newLines | Set-Content -Path $envTarget -Encoding UTF8
Write-Ok ".env written to backend\.env"

# ── STEP 7: Create Database ───────────────────────────────────────────────────
Write-Step "7" "Creating database phq_dashboard"

Start-Sleep -Seconds 3

$env:PGPASSWORD = $DbPass
$checkResult = psql -U postgres -h localhost -p $DbPort -tAc "SELECT 1 FROM pg_database WHERE datname='phq_dashboard';" 2>&1
$dbExists = ("$checkResult".Trim() -eq "1")

if (-not $dbExists) {
    Write-Host "    Creating database..." -ForegroundColor DarkGray
    psql -U postgres -h localhost -p $DbPort -c "CREATE DATABASE phq_dashboard;" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create database phq_dashboard." }
    Write-Ok "Database phq_dashboard created."
} else {
    Write-Ok "Database phq_dashboard already exists."
}
$env:PGPASSWORD = ""

# ── STEP 8: Install PM2 ───────────────────────────────────────────────────────
Write-Step "8" "Installing PM2 globally"

npm install -g pm2 pm2-windows-startup 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to install PM2." }
Write-Ok "PM2 installed."

# ── STEP 9: Backend Build ─────────────────────────────────────────────────────
Write-Step "9" "Installing backend dependencies and building"

Set-Location (Join-Path $InstallDir "backend")

Write-Host "    npm install..." -ForegroundColor DarkGray
npm install --loglevel=error
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend npm install failed." }

Write-Host "    Generating Prisma client..." -ForegroundColor DarkGray
npx prisma generate
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma generate failed." }

Write-Host "    Compiling TypeScript..." -ForegroundColor DarkGray
npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend TypeScript build failed." }

Write-Ok "Backend built."

# ── STEP 10: Frontend Build ───────────────────────────────────────────────────
Write-Step "10" "Building frontend (React + Vite)"

Set-Location (Join-Path $InstallDir "frontend")

Write-Host "    npm install..." -ForegroundColor DarkGray
npm install --loglevel=error
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend npm install failed." }

Write-Host "    Building for production..." -ForegroundColor DarkGray
npm run build
if ($LASTEXITCODE -ne 0) { Write-Fail "Frontend build failed." }

Write-Ok "Frontend built to frontend\dist"

# ── STEP 11: Prisma DB Push ───────────────────────────────────────────────────
Write-Step "11" "Applying database schema"

Set-Location (Join-Path $InstallDir "backend")
npx prisma db push --accept-data-loss
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma db push failed. Check DATABASE_URL in backend\.env." }
Write-Ok "Database schema applied."

# ── STEP 12: Seed Data ────────────────────────────────────────────────────────
Write-Step "12" "Seeding admin account and master data"

Write-Host "    Creating admin account (admin / admin123)..." -ForegroundColor DarkGray
npx tsx create-admin.ts
if ($LASTEXITCODE -ne 0) { Write-Fail "Admin seed script failed." }

Write-Host "    Seeding Haryana districts and police stations..." -ForegroundColor DarkGray
node scripts/seed-master-data.js
# Non-fatal - master data can also sync via CCTNS later

Write-Ok "Admin and master data ready."

# ── STEP 13: PM2 Ecosystem Config ────────────────────────────────────────────
Write-Step "13" "Creating PM2 ecosystem config"

$ecosystemPath = Join-Path $InstallDir "ecosystem.config.cjs"
$cwd = $InstallDir -replace '\\', '/'

$ecosystem = @"
module.exports = {
  apps: [
    {
      name        : 'grievance-monitor',
      script      : 'backend/dist/index.js',
      cwd         : '$cwd',
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

$ecosystem | Set-Content -Path $ecosystemPath -Encoding UTF8
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null
Write-Ok "ecosystem.config.cjs created."

# ── STEP 14: Start with PM2 ───────────────────────────────────────────────────
Write-Step "14" "Starting app with PM2"

Set-Location $InstallDir
$ErrorActionPreference = "Continue"
pm2 delete grievance-monitor 2>&1 | Out-Null
$ErrorActionPreference = "Stop"

pm2 start ecosystem.config.cjs
if ($LASTEXITCODE -ne 0) { Write-Fail "PM2 failed to start the application." }
pm2 save 2>&1 | Out-Null

Write-Host "    Configuring PM2 auto-start on Windows boot..." -ForegroundColor DarkGray
pm2-startup install 2>&1 | Out-Null
Write-Ok "PM2 running and boot-persistence configured."

# ── STEP 15: Health Check ─────────────────────────────────────────────────────
Write-Step "15" "Health check (waiting 15 seconds for warm-up)"

Start-Sleep -Seconds 15

$healthy = $false
$retries = 5
while ($retries -gt 0) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$AppPort/api/health" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    $retries--
    Write-Host "    Not ready yet. Retrying ($retries left)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
}

if (-not $healthy) {
    Write-Host ""
    Write-Host "  WARNING: Health check did not respond." -ForegroundColor Yellow
    Write-Host "  Check logs: pm2 logs grievance-monitor" -ForegroundColor Yellow
} else {
    Write-Ok "Application healthy at http://localhost:$AppPort/api/health"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "         INSTALLATION COMPLETE!                             " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Application : Grievance Monitoring System"
Write-Host "  Department  : Haryana Police Headquarters"
Write-Host "  URL         : http://localhost:$AppPort"
Write-Host "  Login       : admin / admin123"
Write-Host "  Database    : phq_dashboard @ localhost:$DbPort"
Write-Host "  Folder      : $InstallDir"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    pm2 status                   - check running processes"
Write-Host "    pm2 logs grievance-monitor   - view live logs"
Write-Host "    pm2 restart grievance-monitor - restart app"
Write-Host ""
Write-Host "  For future updates run: deploy.bat"
Write-Host ""
Read-Host "Press Enter to close"
