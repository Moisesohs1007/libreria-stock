@echo off
setlocal

set "PS1_URL=https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer/pos_local.ps1"
set "DL_DIR=%TEMP%\LibreriaPOSInstaller"
set "PS1=%DL_DIR%\pos_local.ps1"

if not exist "%DL_DIR%" mkdir "%DL_DIR%" >nul 2>nul

echo Descargando instalador POS local...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try{ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 }; Invoke-WebRequest -Uri '%PS1_URL%' -UseBasicParsing -OutFile '%PS1%'" || (
  echo [ERROR] No se pudo descargar el instalador.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$null=[scriptblock]::Create((Get-Content -Raw '%PS1%'))" || (
  echo [ERROR] El script descargado tiene error de sintaxis.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode install
set "EC=%errorlevel%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] Instalacion fallida (%EC%).
  echo Revisa: C:\LibreriaPOS\logs\doctor_pos_local.log
  echo.
  pause
)
exit /b %EC%

