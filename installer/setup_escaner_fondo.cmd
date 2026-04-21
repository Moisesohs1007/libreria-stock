@echo off
setlocal

set "PS1_URL=https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer/escaner_fondo.ps1"
set "DL_DIR=%TEMP%\LibreriaScannerInstaller"
set "PS1=%DL_DIR%\escaner_fondo.ps1"

if not exist "%DL_DIR%" mkdir "%DL_DIR%" >nul 2>nul

echo Descargando instalador del escaner...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try{ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 }; Invoke-WebRequest -Uri '%PS1_URL%' -UseBasicParsing -OutFile '%PS1%'" || (
  echo [ERROR] No se pudo descargar el instalador.
  echo Verifica tu conexion a internet o permisos.
  pause
  exit /b 1
)
echo Instalador guardado en: %PS1%

powershell -NoProfile -ExecutionPolicy Bypass -Command "$null=[scriptblock]::Create((Get-Content -Raw '%PS1%'))" || (
  echo [ERROR] El script descargado tiene error de sintaxis.
  echo Borra cache temporal y vuelve a intentar:
  echo   rmdir /s /q "%DL_DIR%"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode install
set "EC=%errorlevel%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] El instalador termino con codigo %EC%.
  echo Revisa logs en: C:\LibreriaScanner\logs\doctor_scanner.log
  echo.
  pause
)
exit /b %EC%

