@echo off
setlocal EnableExtensions

title Libreria - Setup PC Vendedor

set "SETUP_VER=20260422f"
set "DL_DIR=%TEMP%\LibreriaInstallerAll"
if not exist "%DL_DIR%" mkdir "%DL_DIR%" >nul 2>nul
set "SETUP_LOG=%DL_DIR%\setup_pc_vendedor.log"
if not exist "%SETUP_LOG%" type nul > "%SETUP_LOG%"
>>"%SETUP_LOG%" echo ============================================
>>"%SETUP_LOG%" echo  SETUP PC VENDEDOR - LOG
>>"%SETUP_LOG%" echo  %DATE% %TIME%
>>"%SETUP_LOG%" echo  TEMP=%TEMP%
>>"%SETUP_LOG%" echo  DL_DIR=%DL_DIR%
>>"%SETUP_LOG%" echo  SCRIPT=%~f0
>>"%SETUP_LOG%" echo  USER=%USERNAME%
>>"%SETUP_LOG%" echo ============================================

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Solicitando permisos de Administrador...
  echo Si esta ventana se cierra, aparecera otra ventana con permisos ^(UAC^). Acepta el aviso.
  >>"%SETUP_LOG%" echo NOT_ADMIN: solicitando elevacion...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath cmd.exe -ArgumentList '/k','""%~f0""' -Verb RunAs" >nul 2>nul
  exit /b 0
)

set "ROOT_URL=https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer"
set "LOCAL_DIR=%~dp0"
set "P_POS=%DL_DIR%\pos_local.ps1"
set "P_SCANNER=%DL_DIR%\escaner_fondo.ps1"
set "P_PRINTS=%DL_DIR%\conteo_impresiones.ps1"
if exist "%LOCAL_DIR%pos_local.ps1" set "P_POS=%LOCAL_DIR%pos_local.ps1"
if exist "%LOCAL_DIR%escaner_fondo.ps1" set "P_SCANNER=%LOCAL_DIR%escaner_fondo.ps1"
if exist "%LOCAL_DIR%conteo_impresiones.ps1" set "P_PRINTS=%LOCAL_DIR%conteo_impresiones.ps1"
>>"%SETUP_LOG%" echo ADMIN_OK: iniciando pasos...

echo.
echo ============================================
echo  LIBRERIA - SETUP PC VENDEDOR (1 clic)
echo ============================================
echo.
echo Version: %SETUP_VER%
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
echo Log instalador: %SETUP_LOG%
echo.
echo Nota: si Windows SmartScreen bloquea el .cmd: clic en "Mas informacion" -> "Ejecutar de todas formas".
echo.

if /I "%P_POS%"=="%DL_DIR%\pos_local.ps1" call :Download "%ROOT_URL%/pos_local.ps1" "%P_POS%" || goto :Fail
call :RunPs "%P_POS%" "install" "POS local (8787)" "C:\LibreriaPOS\logs\doctor_pos_local.log" || goto :Fail

if /I "%P_SCANNER%"=="%DL_DIR%\escaner_fondo.ps1" call :Download "%ROOT_URL%/escaner_fondo.ps1" "%P_SCANNER%" || goto :Fail
call :RunPs "%P_SCANNER%" "install" "Capturador escaner (7777)" "C:\LibreriaScanner\logs\doctor_scanner.log" || goto :Fail

if /I "%P_PRINTS%"=="%DL_DIR%\conteo_impresiones.ps1" call :Download "%ROOT_URL%/conteo_impresiones.ps1" "%P_PRINTS%" || goto :Fail
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
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try{ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 }; Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -OutFile '%OUT%'" >>"%SETUP_LOG%" 2>&1 || exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$null=[scriptblock]::Create((Get-Content -Raw '%OUT%'))" >>"%SETUP_LOG%" 2>&1 || exit /b 1
exit /b 0

:RunPs
set "PS1=%~1"
set "MODE=%~2"
set "LABEL=%~3"
set "STEP_LOG=%~4"
echo.
echo ---- %LABEL% ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode %MODE% >>"%SETUP_LOG%" 2>&1
set "EC=%errorlevel%"
if "%EC%"=="0" exit /b 0
echo.
echo [ERROR] Fallo: %LABEL% - codigo %EC%
echo Revisa log: %STEP_LOG%
echo.
if exist "%SETUP_LOG%" start "" notepad "%SETUP_LOG%" >nul 2>nul
exit /b %EC%
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
echo - Log instalador: %SETUP_LOG%
echo.
if exist "%SETUP_LOG%" start "" notepad "%SETUP_LOG%" >nul 2>nul
pause
exit /b 1

