@echo off
:: ================================================
::  INSTALADOR — Escáner en segundo plano
::  Librería Virgen de la Puerta
::  Ejecutar UNA SOLA VEZ como Administrador
:: ================================================

echo.
echo  Instalando dependencias Python...
echo.

:: Instalar pynput (nueva libreria que reemplaza el hook manual de ctypes)
py -m pip install pynput flask flask-cors

echo.
echo  Configurando inicio automatico del escaner...
echo.

if not exist "C:\LibreriaScanner" mkdir "C:\LibreriaScanner"
copy /Y "%~dp0escaner_fondo.py" "C:\LibreriaScanner\escaner_fondo.py"

:: Copiar emergencia al escritorio
copy /Y "%~dp0MATAR_ESCANER_EMERGENCIA.bat" "%USERPROFILE%\Desktop\MATAR_ESCANER_EMERGENCIA.bat" >nul 2>&1

schtasks /delete /tn "EscanerLibreria" /f >nul 2>&1

schtasks /create /tn "EscanerLibreria" ^
  /tr "pyw C:\LibreriaScanner\escaner_fondo.py" ^
  /sc onlogon ^
  /delay 0000:30 ^
  /rl highest ^
  /f

echo.
echo  LISTO. El escaner arrancara automaticamente.
echo.
echo  IMPORTANTE: Se copio MATAR_ESCANER_EMERGENCIA.bat
echo  en tu escritorio. Si el teclado se bloquea,
echo  doble click con el mouse en ese archivo.
echo.
echo  El escaner espera ~50 segundos tras el inicio
echo  antes de activarse (teclado libre ese tiempo).
echo.
echo  Reinicia la PC para que surta efecto.
echo.
pause
