@echo off
setlocal
title Iniciar - Conteo de Impresiones

set "INSTALL_DIR=C:\LibreriaPrintMonitor"

if not exist "%INSTALL_DIR%\run_service.bat" (
  echo [ERROR] No se encontro la instalacion en %INSTALL_DIR%.
  echo Ejecuta primero: instalar_conteo_impresiones.bat
  pause
  exit /b 1
)

start "LibreriaPrintMonitor" cmd /c "%INSTALL_DIR%\run_service.bat"
echo [OK] Servicio iniciado.
echo Usa esta URL en el panel admin: http://localhost:5056
pause

