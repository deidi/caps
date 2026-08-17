@echo off
setlocal EnableDelayedExpansion
title Caps — Windows Offline Installer
color 0A

echo =======================================================
echo     📸 CAPS — Event Photo Hub Offline Installer
echo        For Windows 10 / Windows 11 (Clean PC)
echo =======================================================
echo.

cd /d "%~dp0"

:: 1. Verify bundled files
echo [1/4] Verifying offline package components...
if not exist "runtime\node.exe" (
    echo [WARNING] Portable runtime\node.exe not found. Checking system node...
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Node runtime is missing. Please ensure runtime\node.exe exists in this folder.
        pause
        exit /b 1
    )
)
if not exist "client\dist\index.html" (
    echo [ERROR] Pre-built client\dist\index.html is missing!
    pause
    exit /b 1
)
echo       ✅ Core files and portable runtime verified.

:: 2. Configure Windows Firewall for Port 1000
echo [2/4] Configuring Windows Defender Firewall for LAN access (Port 1000)...
netsh advfirewall firewall show rule name="Caps Photo Hub" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="Caps Photo Hub" dir=in action=allow protocol=TCP localport=1000 profile=any >nul 2>&1
    if %errorlevel% equ 0 (
        echo       ✅ Windows Firewall rule added for Port 1000.
    ) else (
        echo       ⚠️ Notice: Administrator privileges recommended to open Port 1000 on Windows Firewall.
    )
) else (
    echo       ✅ Windows Firewall rule already active.
)

:: 3. Create Desktop Shortcut
echo [3/4] Creating Desktop shortcut...
set "TARGET_BAT=%~dp0launch-caps.bat"
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Caps Photo Hub.lnk"
set "VBS_SCRIPT=%TEMP%\create_caps_shortcut.vbs"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_SCRIPT%"
echo sLinkFile = "%SHORTCUT_PATH%" >> "%VBS_SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_SCRIPT%"
echo oLink.TargetPath = "%TARGET_BAT%" >> "%VBS_SCRIPT%"
echo oLink.WorkingDirectory = "%~dp0" >> "%VBS_SCRIPT%"
echo oLink.Description = "Caps — Local Network Event Photo Sharing Hub" >> "%VBS_SCRIPT%"
echo oLink.Save >> "%VBS_SCRIPT%"

cscript /nologo "%VBS_SCRIPT%" >nul 2>&1
del "%VBS_SCRIPT%" >nul 2>&1

if exist "%SHORTCUT_PATH%" (
    echo       ✅ Desktop shortcut created: "Caps Photo Hub"
) else (
    echo       ⚠️ Could not create desktop shortcut automatically.
)

:: 4. Completion
echo [4/4] Installation Complete!
echo.
echo =======================================================
echo ✨ Caps is ready to use on this computer offline!
echo.
echo 📁 Location: %~dp0
echo 🔑 Default Admin PIN: 1234 (configured in caps.config.json)
echo 🌐 Port: 1000
echo =======================================================
echo.

set /p START_NOW="Launch Caps now? (Y/N, default=Y): "
if /i "%START_NOW%"=="N" (
    echo You can start Caps anytime by double-clicking "launch-caps.bat" or the Desktop shortcut.
    pause
    exit /b 0
)

call "%~dp0launch-caps.bat"
