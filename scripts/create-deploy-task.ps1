# ==============================================================================
#  create-deploy-task.ps1
#  Registers the "PHQDeploy" Windows Scheduled Task.
#
#  WHY a Scheduled Task?
#  When Node.js/PM2 spawns a child process (deploy.bat), Windows places it
#  inside the same Job Object as PM2.  When deploy.bat runs "pm2 stop ...",
#  PM2 terminates Node.js AND the Job Object kills every child — including
#  deploy.bat itself.  A Scheduled Task runs in Session 0 under SYSTEM,
#  completely outside any Job Object, so it survives PM2 restart.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File create-deploy-task.ps1
#  or from a parent install/bootstrap bat:
#    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\create-deploy-task.ps1" [-InstallDir "C:\PHQ-Dashboard"]
# ==============================================================================

param(
    [string]$InstallDir = ""
)

# ── Resolve install directory ──────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    # Default: folder that contains this script's parent (project root)
    $InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$InstallDir = $InstallDir.TrimEnd('\')
$DeployBat  = Join-Path $InstallDir "deploy.bat"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHQDeploy — Scheduled Task Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Install dir  : $InstallDir" -ForegroundColor Gray
Write-Host "  deploy.bat   : $DeployBat"  -ForegroundColor Gray
Write-Host ""

# ── Verify deploy.bat exists ──────────────────────────────────────────────────
if (-not (Test-Path $DeployBat)) {
    Write-Host "  ERROR: deploy.bat not found at: $DeployBat" -ForegroundColor Red
    Write-Host "  Make sure you run this script from the project root." -ForegroundColor Red
    exit 1
}

# ── Build Scheduled Task components ───────────────────────────────────────────
# Action: cmd.exe /c "<path>\deploy.bat"
# We use cmd.exe as the wrapper so the .bat extension is handled correctly
# and the working directory is set explicitly.
$action = New-ScheduledTaskAction `
    -Execute    "cmd.exe" `
    -Argument   "/c `"$DeployBat`"" `
    -WorkingDirectory $InstallDir

# Trigger: far-future one-time trigger (task is meant to be triggered manually
# via schtasks /run, not on a schedule)
$farFuture = (Get-Date).AddYears(99)
$trigger   = New-ScheduledTaskTrigger -Once -At $farFuture

# Settings: no time limit failure, only one instance at a time
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit      (New-TimeSpan -Hours 2) `
    -MultipleInstances       IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

# Principal: run as SYSTEM at highest privilege — completely outside any Job Object
$principal = New-ScheduledTaskPrincipal `
    -UserId    "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel  Highest

# ── Register (or update) the task ─────────────────────────────────────────────
try {
    Register-ScheduledTask `
        -TaskName   "PHQDeploy" `
        -TaskPath   "\" `
        -Action     $action `
        -Trigger    $trigger `
        -Settings   $settings `
        -Principal  $principal `
        -Description "PHQ Complaint Dashboard — UI-triggered deployment (github pull + rebuild + pm2 restart)" `
        -Force `
        -ErrorAction Stop | Out-Null

    Write-Host "  [OK]  Scheduled task 'PHQDeploy' registered successfully." -ForegroundColor Green
    Write-Host ""
    Write-Host "  The UI Update button will now trigger:" -ForegroundColor Gray
    Write-Host "    schtasks /run /tn PHQDeploy" -ForegroundColor Gray
    Write-Host "  which runs deploy.bat as SYSTEM, outside PM2's Job Object." -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "  ERROR registering scheduled task: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Make sure this script is run as Administrator." -ForegroundColor Yellow
    exit 1
}

# ── Verify it was created ──────────────────────────────────────────────────────
$task = Get-ScheduledTask -TaskName "PHQDeploy" -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "  WARNING: Task was registered but could not be verified." -ForegroundColor Yellow
} else {
    Write-Host "  [OK]  Verified: task state = $($task.State)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Done. You can test manually with:" -ForegroundColor Gray
Write-Host "    schtasks /run /tn PHQDeploy" -ForegroundColor White
Write-Host ""
