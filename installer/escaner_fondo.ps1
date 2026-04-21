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
  $pid = Get-PortPid $port
  if (-not $pid) { return }
  try {
    Write-LogLine "Deteniendo proceso en puerto $port (PID=$pid)"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
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

function Resolve-Python {
  $candidates = @(
    "$InstallDir\python\pythonw.exe",
    "$InstallDir\python\python.exe",
    (Get-Command python.exe -ErrorAction SilentlyContinue).Source,
    (Get-Command py.exe -ErrorAction SilentlyContinue).Source
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
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
    & $py -m pip install --upgrade pip | Out-Null
    & $py -m pip install flask flask-cors pynput | Out-Null
    Write-LogLine "OK dependencias instaladas."
  } catch {
    Write-LogLine "ERROR instalando dependencias: $($_.Exception.Message)"
    throw
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
  Install-ScannerScript
  $PyExe = Resolve-Python
  if (-not $PyExe) {
    Write-LogLine "ERROR: Python no encontrado. Instala Python en esta PC (o configura el instalador avanzado)."
    throw "PYTHON_NOT_FOUND"
  }
  $PyW = $PyExe
  if ($PyW -like "*python.exe") { $PyW = $PyW -replace "python\.exe$","pythonw.exe" }
  if (-not (Test-Path -LiteralPath $PyW)) { $PyW = $PyExe }
  Ensure-Dependencies $PyExe
  Install-Task $PyW
  Start-Task
  Test-Endpoints
  Write-LogLine "INSTALACION_OK"
  exit 0
}

if ($Mode -eq "doctor") {
  Write-LogLine "PID puerto 7777: $(Get-PortPid 7777)"
  Write-LogLine "Python detectado: $(Resolve-Python)"
  Test-Endpoints
  Write-LogLine "Fin doctor. Log: $global:LogPath"
  exit 0
}

