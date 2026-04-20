@echo off
setlocal
title Instalador - Conteo de Impresiones

set "INSTALL_DIR=C:\LibreriaPrintMonitor"
set "TASK_NAME=LibreriaPrintMonitor"
set "REPO_OWNER=Moisesohs1007"
set "REPO_NAME=libreria-stock"
set "REPO_BRANCH=main"
set "BASE_RAW=https://raw.githubusercontent.com/%REPO_OWNER%/%REPO_NAME%/%REPO_BRANCH%/print_service"

echo ===============================================
echo  Instalador de Conteo de Impresiones
echo ===============================================
echo Directorio destino: %INSTALL_DIR%
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Python Launcher (py).
  echo Instala Python 3.11+ desde https://www.python.org/downloads/ y marca "Add Python to PATH".
  pause
  exit /b 1
)

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\print_service" mkdir "%INSTALL_DIR%\print_service"

echo [1/4] Descargando archivos del servicio...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$files=@('__init__.py','db.py','filters.py','monitor.py','exports.py','server.py','requirements.txt','README.md');" ^
  "foreach($f in $files){" ^
  "  $u='%BASE_RAW%/'+$f;" ^
  "  $o='%INSTALL_DIR%\print_service\'+$f;" ^
  "  Invoke-WebRequest -Uri $u -UseBasicParsing -OutFile $o;" ^
  "}"
if errorlevel 1 (
  echo [ERROR] No se pudieron descargar archivos desde GitHub.
  pause
  exit /b 1
)

echo [2/4] Creando script de ejecucion local...
(
  echo @echo off
  echo setlocal
  echo cd /d "%%~dp0"
  echo set "PRINT_HOST=0.0.0.0"
  echo set "PRINT_PORT=5056"
  echo py -m pip install --disable-pip-version-check -r print_service\requirements.txt
  echo if errorlevel 1 ^(
  echo   echo [ERROR] Fallo instalando dependencias.
  echo   pause
  echo   exit /b 1
  echo ^)
  echo py -m print_service.server
) > "%INSTALL_DIR%\run_service.bat"

echo [3/4] Instalando dependencias iniciales...
pushd "%INSTALL_DIR%"
py -m pip install --disable-pip-version-check -r print_service\requirements.txt
if errorlevel 1 (
  popd
  echo [ERROR] No se pudieron instalar dependencias Python.
  pause
  exit /b 1
)
popd

echo [4/4] Configurando inicio automatico y ejecutando servicio...
schtasks /create /f /sc onlogon /tn "%TASK_NAME%" /tr "cmd /c \"\"%INSTALL_DIR%\run_service.bat\"\"" /rl LIMITED /delay 0000:30 >nul 2>nul
if errorlevel 1 (
  echo [WARN] No se pudo crear tarea programada. Ejecuta este .bat como Administrador para auto-inicio.
)

start "LibreriaPrintMonitor" cmd /c "%INSTALL_DIR%\run_service.bat"

echo.
echo [OK] Instalacion finalizada.
echo URL local recomendada para el panel admin: http://localhost:5056
echo URL para otras PCs en red: http://IP_DE_ESTA_PC:5056
echo.
pause

