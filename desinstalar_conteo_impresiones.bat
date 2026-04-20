@echo off
setlocal
title Desinstalar - Conteo de Impresiones

set "INSTALL_DIR=C:\LibreriaPrintMonitor"
set "TASK_NAME=LibreriaPrintMonitor"

echo ===============================================
echo  Desinstalar Conteo de Impresiones
echo ===============================================
echo.

schtasks /end /tn "%TASK_NAME%" >nul 2>nul
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>nul

if exist "%INSTALL_DIR%" (
  rmdir /s /q "%INSTALL_DIR%"
)

echo [OK] Se elimino la tarea programada y la carpeta de instalacion.
echo Si quedo alguna ventana abierta del servicio, cierrala manualmente.
pause

