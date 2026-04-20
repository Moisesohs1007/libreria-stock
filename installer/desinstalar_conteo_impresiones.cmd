@echo off
setlocal
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%conteo_impresiones.ps1" -Mode uninstall
pause

