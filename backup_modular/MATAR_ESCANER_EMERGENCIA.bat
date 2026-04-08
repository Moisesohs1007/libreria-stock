@echo off
title EMERGENCIA: Restaurar Teclado
echo.
echo ======================================================
echo   EMERGENCIA: RESTAURANDO TECLADO FISICO
echo ======================================================
echo.
echo Cerrando procesos del escáner...
taskkill /f /im python.exe /t >nul 2>&1
taskkill /f /im py.exe /t >nul 2>&1

echo.
echo Limpiando tareas programadas...
schtasks /end /tn "EscanerLibreria" >nul 2>&1

echo.
echo ======================================================
echo   TECLADO RESTAURADO. 
echo   Ya puedes escribir normalmente en cualquier programa.
echo ======================================================
echo.
pause
