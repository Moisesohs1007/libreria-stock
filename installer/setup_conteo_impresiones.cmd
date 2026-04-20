@echo off
setlocal

set "ROOT=%~dp0"
set "PS1=%ROOT%conteo_impresiones.ps1"

if not exist "%PS1%" (
  echo [ERROR] No se encontro %PS1%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode install
exit /b %errorlevel%

