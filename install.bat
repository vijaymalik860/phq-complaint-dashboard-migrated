@echo off
setlocal disabledelayedexpansion
title Grievance Monitoring System - Automated Installation
color 0A

:: ── Self-elevate to Administrator ────────────────────────────────────────────
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

:: ── Download install.ps1 from GitHub and run it ───────────────────────────
echo Downloading installation script...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "(New-Object System.Net.WebClient).DownloadFile('https://raw.githubusercontent.com/jimmysh2/phq-complaint-dashboard-migrated/main/install.ps1', '%TEMP%\gms-install.ps1')"

if errorlevel 1 (
    echo.
    echo ERROR: Could not download install.ps1 from GitHub.
    echo Check internet connection and try again.
    echo.
    pause
    exit /b 1
)

echo Download complete. Starting installation...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\gms-install.ps1"

echo.
echo ========================================================
echo   Script finished. Press any key to close.
echo ========================================================
pause >nul
exit /b 0
