@echo off
setlocal EnableExtensions

title Libreria - Setup PC Vendedor

set "DL_DIR=%TEMP%\LibreriaInstallerAll"
if not exist "%DL_DIR%" mkdir "%DL_DIR%" >nul 2>nul
set "LOG=%DL_DIR%\setup_pc_vendedor.log"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Solicitando permisos de Administrador...
  echo Si esta ventana se cierra, aparecera otra ventana con permisos (UAC). Acepta el aviso.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%ComSpec%' -ArgumentList '/k','\"\"%~f0\"\"' -Verb RunAs" >nul 2>nul
  exit /b 0
)

set "ROOT_URL=https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer"
set "P_POS=%DL_DIR%\pos_local.ps1"
set "P_SCANNER=%DL_DIR%\escaner_fondo.ps1"
set "P_PRINTS=%DL_DIR%\conteo_impresiones.ps1"

echo.>>"%LOG%"
echo ============================================>>"%LOG%"
echo  SETUP PC VENDEDOR - LOG>>"%LOG%"
echo  %DATE% %TIME%>>"%LOG%"
echo ============================================>>"%LOG%"

echo.
echo ============================================
echo  LIBRERIA - SETUP PC VENDEDOR (1 clic)
echo ============================================
echo.
echo Este instalador configura en esta PC:
echo - POS local (web):        http://127.0.0.1:8787/
echo - Capturador escaner:     http://127.0.0.1:7777/status
echo - Conteo de impresiones:  http://127.0.0.1:5056/api/prints/health
echo.
echo Logs (si algo sale rojo):
echo - POS:       C:\LibreriaPOS\logs\doctor_pos_local.log
echo - Escaner:   C:\LibreriaScanner\logs\doctor_scanner.log
echo - Impresion: C:\LibreriaPrintMonitor\logs\installer.log
echo.
echo Log instalador: %LOG%
echo.
echo Nota: si Windows SmartScreen bloquea el .cmd: clic en "Mas informacion" -> "Ejecutar de todas formas".
echo.

call :Download "%ROOT_URL%/pos_local.ps1" "%P_POS%" || goto :Fail
call :RunPs "%P_POS%" "install" "POS local (8787)" "C:\LibreriaPOS\logs\doctor_pos_local.log" || goto :Fail

call :Download "%ROOT_URL%/escaner_fondo.ps1" "%P_SCANNER%" || goto :Fail
call :RunPs "%P_SCANNER%" "install" "Capturador escaner (7777)" "C:\LibreriaScanner\logs\doctor_scanner.log" || goto :Fail

call :Download "%ROOT_URL%/conteo_impresiones.ps1" "%P_PRINTS%" || goto :Fail
call :RunPs "%P_PRINTS%" "install" "Conteo impresiones (5056)" "C:\LibreriaPrintMonitor\logs\installer.log" || goto :Fail

echo.
echo ============================================
echo  LISTO
echo ============================================
echo.
echo Abre el sistema en esta PC por:
echo   http://127.0.0.1:8787/
echo.
start "" "http://127.0.0.1:8787/" >nul 2>nul
pause
exit /b 0

:Download
set "URL=%~1"
set "OUT=%~2"
echo Descargando: %URL%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try{ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 }; Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -OutFile '%OUT%'" >>"%LOG%" 2>>&1 || exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$null=[scriptblock]::Create((Get-Content -Raw '%OUT%'))" >>"%LOG%" 2>>&1 || exit /b 1
exit /b 0

:RunPs
set "PS1=%~1"
set "MODE=%~2"
set "LABEL=%~3"
set "LOG=%~4"
echo.
echo ---- %LABEL% ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode %MODE% >>"%LOG%" 2>>&1
set "EC=%errorlevel%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] Fallo: %LABEL% (codigo %EC%)
  echo Revisa log: %LOG%
  echo.
  if exist "%LOG%" start "" notepad "%LOG%" >nul 2>nul
  exit /b %EC%
)
exit /b 0

:Fail
echo.
echo ============================================
echo  ERROR
echo ============================================
echo.
echo No se pudo completar la instalacion.
echo.
echo Recomendado:
echo - Verifica Internet
echo - Ejecuta este .cmd como Administrador
echo - Abre los logs indicados arriba y copia el ultimo error
echo - Log instalador: %DL_DIR%\setup_pc_vendedor.log
echo.
if exist "%DL_DIR%\setup_pc_vendedor.log" start "" notepad "%DL_DIR%\setup_pc_vendedor.log" >nul 2>nul
pause
exit /b 1

