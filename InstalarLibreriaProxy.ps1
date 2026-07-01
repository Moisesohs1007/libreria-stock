<#
.SYNOPSIS
Instalador automático para el proxy de fotocopiadoras de Librería Virgen de la Puerta
.DESCRIPTION
Instala Node.js, descarga el proxy, configura el inicio automático y abre la app
#>

# Requerir privilegios de administrador (para agregar al inicio)
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator"))  
{  
  $arguments = "& '" +$myinvocation.mycommand.definition + "'"
  Start-Process powershell -Verb runAs -ArgumentList $arguments
  Break
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Instalador de Librería Proxy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------
# 1. Verificar/Instalar Node.js
# -------------------------------
Write-Host "1. Verificando Node.js..." -ForegroundColor Yellow
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "   Node.js no está instalado. Descargando..." -ForegroundColor Red
    # Descargar Node.js LTS
    $nodeUrl = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi"
    $nodeInstaller = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller
    Write-Host "   Instalando Node.js (espera un momento)..." -ForegroundColor Yellow
    Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/quiet", "/norestart" -Wait
    Write-Host "   Node.js instalado correctamente!" -ForegroundColor Green
    Remove-Item $nodeInstaller
    # Actualizar PATH para que Node.js esté disponible inmediatamente
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "   Node.js ya está instalado!" -ForegroundColor Green
}

# -------------------------------
# 2. Crear carpeta del proxy
# -------------------------------
Write-Host ""
Write-Host "2. Creando carpeta del proxy..." -ForegroundColor Yellow
$proxyFolder = "C:\LibreriaProxy"
if (-not (Test-Path $proxyFolder)) {
    New-Item -ItemType Directory -Path $proxyFolder | Out-Null
}
Set-Location $proxyFolder
Write-Host "   Carpeta creada en: $proxyFolder" -ForegroundColor Green

# -------------------------------
# 3. Descargar el proxy desde GitHub
# -------------------------------
Write-Host ""
Write-Host "3. Descargando el proxy..." -ForegroundColor Yellow
$proxyUrl = "https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/proxy-fotocopiadoras.js"
$proxyFile = "$proxyFolder\proxy-fotocopiadoras.js"
Invoke-WebRequest -Uri $proxyUrl -OutFile $proxyFile
Write-Host "   Proxy descargado correctamente!" -ForegroundColor Green

# -------------------------------
# 4. Instalar dependencias del proxy
# -------------------------------
Write-Host ""
Write-Host "4. Instalando dependencias del proxy..." -ForegroundColor Yellow
npm install express net-snmp cors
Write-Host "   Dependencias instaladas!" -ForegroundColor Green

# -------------------------------
# 5. Crear archivos batch
# -------------------------------
Write-Host ""
Write-Host "5. Creando archivos de inicio..." -ForegroundColor Yellow

# Archivo para iniciar el proxy
$proxyBatch = @"
@echo off
echo Iniciando proxy de fotocopiadoras...
cd /d "$proxyFolder"
node proxy-fotocopiadoras.js
pause
"@
$proxyBatch | Out-File -FilePath "$proxyFolder\IniciarProxy.bat" -Encoding ASCII

# Archivo para abrir la app y el proxy
$appBatch = @"
@echo off
echo Abriendo Librería...
start chrome "https://moisesohs1007.github.io/libreria-stock/"
timeout /t 3
start "" "$proxyFolder\IniciarProxy.bat"
"@
$appBatch | Out-File -FilePath "$proxyFolder\AbrirLibreria.bat" -Encoding ASCII

Write-Host "   Archivos creados!" -ForegroundColor Green

# -------------------------------
# 6. Agregar al inicio de Windows
# -------------------------------
Write-Host ""
Write-Host "6. Configurando inicio automático..." -ForegroundColor Yellow
$startupFolder = [Environment]::GetFolderPath("Startup")
Copy-Item -Path "$proxyFolder\AbrirLibreria.bat" -Destination $startupFolder
Write-Host "   Inicio automático configurado!" -ForegroundColor Green

# -------------------------------
# 7. Finalizar y abrir la app
# -------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ¡Instalación completada!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Se abrirá la app en 5 segundos..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
Start-Process "https://moisesohs1007.github.io/libreria-stock/"

Write-Host ""
Write-Host "Presiona cualquier tecla para cerrar..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
