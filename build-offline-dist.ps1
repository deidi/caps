# Caps Offline Distribution Package Builder
$ErrorActionPreference = "Stop"

$version = "1.0.0"
$distRoot = Join-Path $PSScriptRoot "dist-offline"
$packageDir = Join-Path $distRoot "Caps-v$version-Windows-Offline"
$zipFile = Join-Path $distRoot "Caps-v$version-Windows-Offline.zip"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Building Caps Offline Distribution Package (v$version)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Clean previous dist
if (Test-Path $distRoot) {
    Write-Host "Cleaning previous dist folder..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $distRoot
}

New-Item -ItemType Directory -Force -Path $packageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir "runtime") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir "client") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir "server") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir "server/data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageDir "server/data/events") | Out-Null

# 2. Build Client UI
Write-Host "Building client UI..." -ForegroundColor Green
Push-Location (Join-Path $PSScriptRoot "client")
npm.cmd run build
Pop-Location

# 3. Copy files
Write-Host "Copying offline bundle files..." -ForegroundColor Green
Copy-Item (Join-Path $PSScriptRoot "launch-caps.bat") -Destination $packageDir
Copy-Item (Join-Path $PSScriptRoot "install-caps-offline.bat") -Destination $packageDir
Copy-Item (Join-Path $PSScriptRoot "caps.config.json") -Destination $packageDir
Copy-Item (Join-Path $PSScriptRoot "README.md") -Destination $packageDir

# Portable Node runtime
if (Test-Path (Join-Path $PSScriptRoot "runtime\node.exe")) {
    Copy-Item (Join-Path $PSScriptRoot "runtime\node.exe") -Destination (Join-Path $packageDir "runtime\node.exe")
} else {
    Copy-Item "C:\Program Files\nodejs\node.exe" -Destination (Join-Path $packageDir "runtime\node.exe")
}

# Client build
Copy-Item -Recurse (Join-Path $PSScriptRoot "client\dist") -Destination (Join-Path $packageDir "client\dist")

# Server code & node_modules
Copy-Item -Recurse (Join-Path $PSScriptRoot "server\src") -Destination (Join-Path $packageDir "server\src")
Copy-Item -Recurse (Join-Path $PSScriptRoot "server\node_modules") -Destination (Join-Path $packageDir "server\node_modules")
Copy-Item (Join-Path $PSScriptRoot "server\package.json") -Destination (Join-Path $packageDir "server\package.json")

# Clean database in dist
Push-Location (Join-Path $packageDir "server")
$resetProcess = Start-Process -FilePath "node.exe" -ArgumentList "src/reset-db.js" -NoNewWindow -Wait -PassThru
Pop-Location
Start-Sleep -Seconds 1

# 4. Create ZIP Archive
Write-Host "Creating ZIP archive for USB deployment..." -ForegroundColor Green
Compress-Archive -Path "$packageDir\*" -DestinationPath $zipFile -Force

$zipBytes = (Get-Item $zipFile).Length
$zipMb = [math]::Round($zipBytes / 1MB, 2)
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "OFFLINE PACKAGE CREATED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "Folder: $packageDir"
Write-Host "ZIP:    $zipFile ($zipMb MB)"
Write-Host ""
Write-Host "To use on ANY clean Windows 10/11 laptop (No Node.js needed):" -ForegroundColor Cyan
Write-Host "   1. Copy the ZIP file to a USB flash drive." -ForegroundColor White
Write-Host "   2. Extract to the host laptop." -ForegroundColor White
Write-Host "   3. Double-click 'install-caps-offline.bat' or 'launch-caps.bat'." -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor Green
