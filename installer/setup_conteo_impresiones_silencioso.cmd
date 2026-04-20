@echo off
setlocal

set "PS1_URL=https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer/conteo_impresiones.ps1"
set "DL_DIR=%TEMP%\LibreriaPrintMonitorInstaller"
set "PS1=%DL_DIR%\conteo_impresiones.ps1"

if not exist "%DL_DIR%" mkdir "%DL_DIR%" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try{ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 }; Invoke-WebRequest -Uri '%PS1_URL%' -UseBasicParsing -OutFile '%PS1%'" || exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS1%" -Mode install -Silent
exit /b %errorlevel%

