param(
    [string]$InstallDir = ""
)

# Resolve install directory
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$InstallDir = $InstallDir.TrimEnd('\')
$DeployBat  = Join-Path $InstallDir "deploy.bat"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHQDeploy -- Scheduled Task Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Install dir : $InstallDir" -ForegroundColor Gray
Write-Host "  deploy.bat  : $DeployBat" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $DeployBat)) {
    Write-Host "  ERROR: deploy.bat not found at: $DeployBat" -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$DeployBat`"" `
    -WorkingDirectory $InstallDir

$farFuture = (Get-Date).AddYears(99)
$trigger   = New-ScheduledTaskTrigger -Once -At $farFuture

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

$registered = $false
try {
    Register-ScheduledTask `
        -TaskName "PHQDeploy" `
        -TaskPath "\" `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "PHQ Dashboard UI-triggered deployment" `
        -Force `
        -ErrorAction Stop | Out-Null
    $registered = $true
} catch {
    Write-Host "  ERROR registering scheduled task: $_" -ForegroundColor Red
    Write-Host "  Make sure this script is run as Administrator." -ForegroundColor Yellow
    exit 1
}

if ($registered) {
    Write-Host "  [OK]  Scheduled task PHQDeploy registered." -ForegroundColor Green
}

$task = Get-ScheduledTask -TaskName "PHQDeploy" -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "  WARNING: Could not verify task after registration." -ForegroundColor Yellow
} else {
    Write-Host "  [OK]  Verified: state = $($task.State)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Test manually: schtasks /run /tn PHQDeploy" -ForegroundColor Gray
Write-Host ""
