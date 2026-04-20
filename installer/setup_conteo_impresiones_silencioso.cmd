@echo off
setlocal

set "ROOT=%~dp0"
set "PS1=%ROOT%conteo_impresiones.ps1"

if not exist "%PS1%" (
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PS1%" -Mode install -Silent
exit /b %errorlevel%

