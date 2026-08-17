# Caps — PowerShell Host Launcher
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "    📸 CAPS — Event Photo Hub (Windows Host)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found on PATH. Please install Node.js (v20+) from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

# Check Client Build
if (-not (Test-Path "client\dist\index.html")) {
    Write-Host "[INFO] Building modern client UI bundle..." -ForegroundColor Yellow
    Set-Location "$scriptDir\client"
    npm.cmd run build
    Set-Location $scriptDir
}

# Launch Server & Browser
Write-Host "[INFO] Starting Caps Server and opening Host Dashboard..." -ForegroundColor Green
Set-Location "$scriptDir\server"
node src/launcher.js
