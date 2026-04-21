param(
  [Parameter(Mandatory=$false)][ValidateSet("install","doctor","start","stop","uninstall")] [string]$Mode = "doctor"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-LogLine($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "$ts $msg"
  Write-Host $line
  try { Add-Content -LiteralPath $global:LogPath -Value $line -Encoding UTF8 } catch {}
}

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) { return }
  Write-Host "Solicitando permisos de Administrador..."
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode $Mode"
  Start-Process -FilePath "powershell" -ArgumentList $args -Verb RunAs | Out-Null
  exit 0
}

function Get-PortPid([int]$port) {
  try {
    $line = (netstat -ano | Select-String ":$port\s+.*LISTENING" | Select-Object -First 1).Line
    if (-not $line) { return $null }
    $parts = ($line -split "\s+") | Where-Object { $_ -ne "" }
    return [int]$parts[-1]
  } catch { return $null }
}

function Stop-Port([int]$port) {
  $procId = Get-PortPid $port
  if (-not $procId) { return }
  try {
    Write-LogLine "Deteniendo proceso en puerto $port (PID=$procId)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  } catch {}
}

function Ensure-Dir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

$InstallDir = "C:\LibreriaScanner"
Ensure-Dir $InstallDir
Ensure-Dir "$InstallDir\logs"
$global:LogPath = "$InstallDir\logs\doctor_scanner.log"

Write-LogLine "=== Scanner Doctor: $Mode ==="
Write-LogLine "InstallDir=$InstallDir"
Write-LogLine "Script=$PSCommandPath"

$TaskName = "EscanerLibreria"
$PyExe = $null

function Install-EmergencyUnblock {
  try {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $baseDir = $InstallDir
    if (-not $isAdmin) {
      $baseDir = Join-Path $env:LOCALAPPDATA "LibreriaScanner"
      Ensure-Dir $baseDir
    }
    $dst = Join-Path $baseDir "DESBLOQUEAR_TECLADO_ESCANER.cmd"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $dstDesktop = Join-Path $desktop "DESBLOQUEAR_TECLADO_ESCANER.cmd"
    $content = @"
@echo off
title DESBLOQUEAR TECLADO (Escaner)
echo.
echo Deteniendo tarea EscanerLibreria...
schtasks /end /tn "EscanerLibreria" >nul 2>nul
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":7777 .*LISTENING"') do (
  echo Matando PID %%a (puerto 7777)...
  taskkill /F /PID %%a >nul 2>nul
)
echo.
echo TECLADO RESTAURADO.
echo.
pause
"@
    Set-Content -LiteralPath $dst -Value $content -Encoding ASCII
    Copy-Item -LiteralPath $dst -Destination $dstDesktop -Force -ErrorAction SilentlyContinue
    Write-LogLine "Comando de emergencia creado: $dstDesktop"
  } catch {
    Write-LogLine "WARN no se pudo crear comando de emergencia: $($_.Exception.Message)"
  }
}

function Resolve-PythonExe {
  $cmdPython = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
  $localPython = (Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Python\\Python*\\python.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
  $candidates = @(
    "$InstallDir\\python\\python.exe",
    $localPython,
    $cmdPython
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and ($_ -notlike "*\\Microsoft\\WindowsApps\\python.exe") } | Select-Object -Unique
  if ($candidates.Count -gt 0) { return $candidates[0] }
  return $null
}

function Resolve-PythonW([string]$pyExe) {
  $cmdPythonW = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
  $cmdPyW = (Get-Command pyw.exe -ErrorAction SilentlyContinue).Source
  $localPythonW = (Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Python\\Python*\\pythonw.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
  $fromExe = $null
  if ($pyExe -and ($pyExe -like "*python.exe")) { $fromExe = ($pyExe -replace "python\.exe$","pythonw.exe") }
  $candidates = @(
    "$InstallDir\\python\\pythonw.exe",
    $fromExe,
    $localPythonW,
    $cmdPythonW,
    $cmdPyW
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and ($_ -notlike "*\\Microsoft\\WindowsApps\\python.exe") } | Select-Object -Unique
  if ($candidates.Count -gt 0) { return $candidates[0] }
  return $null
}

function Ensure-Dependencies([string]$py) {
  try {
    Write-LogLine "Verificando dependencias Python (flask, flask-cors, pynput)..."
    & $py -c "import flask, flask_cors, pynput" 2>$null
    Write-LogLine "OK dependencias presentes."
    return
  } catch {}

  try {
    Write-LogLine "Instalando dependencias via pip..."
    $p0 = Start-Process -FilePath $py -ArgumentList @("-m","pip","install","--upgrade","pip") -NoNewWindow -Wait -PassThru -ErrorAction Stop
    if ($p0.ExitCode -ne 0) {
      Start-Process -FilePath $py -ArgumentList @("-m","ensurepip","--upgrade") -NoNewWindow -Wait -PassThru -ErrorAction SilentlyContinue | Out-Null
      $p0 = Start-Process -FilePath $py -ArgumentList @("-m","pip","install","--upgrade","pip") -NoNewWindow -Wait -PassThru -ErrorAction Stop
      if ($p0.ExitCode -ne 0) { throw "pip_upgrade_failed_$($p0.ExitCode)" }
    }
    $p1 = Start-Process -FilePath $py -ArgumentList @("-m","pip","install","flask","flask-cors","pynput") -NoNewWindow -Wait -PassThru -ErrorAction Stop
    if ($p1.ExitCode -ne 0) { throw "pip_install_failed_$($p1.ExitCode)" }
    Write-LogLine "OK dependencias instaladas."
  } catch {
    Write-LogLine "WARN instalando dependencias: $($_.Exception.Message)"
    Write-LogLine "Continuando instalación (si ya estaban instaladas, el servicio igual funcionará)."
    return
  }
}

function Install-ScannerScript {
  $dst = "$InstallDir\escaner_fondo.py"
  $url = "https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/escaner_fondo.py"
  Write-LogLine "Descargando escaner_fondo.py -> $dst"
  Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $dst
}

function Task-Exists {
  $out = & schtasks /query /tn $TaskName 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Install-Task([string]$pyw) {
  $script = "$InstallDir\escaner_fondo.py"
  $action = "`"$pyw`" `"$script`""
  if (Task-Exists) {
    Write-LogLine "Actualizando tarea programada $TaskName"
    & schtasks /delete /tn $TaskName /f 1>$null 2>$null
  } else {
    Write-LogLine "Creando tarea programada $TaskName"
  }
  & schtasks /create /tn $TaskName /sc onlogon /rl highest /delay 0000:30 /tr $action /f | Out-Null
}

function Start-Task {
  if (-not (Task-Exists)) { Write-LogLine "Tarea no existe: $TaskName"; return }
  & schtasks /run /tn $TaskName | Out-Null
  Write-LogLine "Tarea iniciada: $TaskName"
}

function Stop-Task {
  if (-not (Task-Exists)) { return }
  & schtasks /end /tn $TaskName 1>$null 2>$null
  Write-LogLine "Tarea detenida: $TaskName"
}

function Uninstall-All {
  Stop-Task
  Stop-Port 7777
  if (Task-Exists) { & schtasks /delete /tn $TaskName /f 1>$null 2>$null }
  Write-LogLine "Desinstalación OK (tarea y proceso). Carpeta se mantiene: $InstallDir"
}

function Test-Endpoints {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:7777/status" -TimeoutSec 2
    Write-LogLine ("OK /status: " + ($status | ConvertTo-Json -Compress))
  } catch {
    Write-LogLine "ERROR /status: $($_.Exception.Message)"
  }
  try {
    $poll = Invoke-RestMethod -Uri "http://127.0.0.1:7777/poll" -TimeoutSec 2
    Write-LogLine ("OK /poll: " + ($poll | ConvertTo-Json -Compress))
  } catch {
    Write-LogLine "ERROR /poll: $($_.Exception.Message)"
  }
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:7777/health" -TimeoutSec 2
    Write-LogLine ("OK /health: " + ($health | ConvertTo-Json -Compress))
  } catch {
    Write-LogLine "WARN /health no disponible (no es crítico): $($_.Exception.Message)"
  }
}

if ($Mode -in @("install","uninstall")) { Ensure-Admin }

if ($Mode -eq "uninstall") {
  Uninstall-All
  exit 0
}

if ($Mode -eq "stop") {
  Ensure-Admin
  Stop-Task
  Stop-Port 7777
  exit 0
}

if ($Mode -eq "start") {
  Ensure-Admin
  Start-Task
  Test-Endpoints
  exit 0
}

if ($Mode -eq "install") {
  Ensure-Admin
  Stop-Task
  Stop-Port 7777
  Install-EmergencyUnblock
  Install-ScannerScript
  $PyExe = Resolve-PythonExe
  if (-not $PyExe) {
    Write-LogLine "ERROR: Python no encontrado. Instala Python en esta PC (o configura el instalador avanzado)."
    throw "PYTHON_NOT_FOUND"
  }
  $PyW = Resolve-PythonW $PyExe
  if (-not $PyW) { $PyW = $PyExe }
  Ensure-Dependencies $PyExe
  Install-Task $PyW
  Start-Task
  Test-Endpoints
  Write-LogLine "INSTALACION_OK"
  exit 0
}

if ($Mode -eq "doctor") {
  Write-LogLine "PID puerto 7777: $(Get-PortPid 7777)"
  $pyExe = Resolve-PythonExe
  Write-LogLine "Python exe: $pyExe"
  Write-LogLine "Python w: $(Resolve-PythonW $pyExe)"
  Install-EmergencyUnblock
  Test-Endpoints
  Write-LogLine "Fin doctor. Log: $global:LogPath"
  exit 0
}

