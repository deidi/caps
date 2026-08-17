@echo off
setlocal
title Caps - Event Photo Hub
color 0B

echo ===================================================
echo      CAPS - Event Photo Hub (Windows Host)
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Detect Node.js runtime (bundled portable runtime or system PATH)
set "NODE_BIN=node"
if exist "runtime\node.exe" (
    set "NODE_BIN=%~dp0runtime\node.exe"
    echo [INFO] Using bundled portable Node.js runtime.
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Node.js was not found on your system!
        echo Please install Node.js v20 or newer, or include runtime\node.exe in this folder.
        echo.
        pause
        exit /b 1
    )
)

:: 2. Check if client is built
if not exist "client\dist\index.html" (
    echo [INFO] Building modern client UI bundle...
    pushd client
    call npm.cmd run build
    popd
)

:: 3. Launch Caps Server & Browser
echo [INFO] Starting Caps Server and opening Host Dashboard...
echo.
pushd server
"%NODE_BIN%" src/launcher.js
popd

pause
