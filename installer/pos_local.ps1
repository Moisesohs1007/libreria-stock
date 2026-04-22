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

function Ensure-Dir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
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

function Resolve-Python {
  $cmdPython = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
  $candidates = @(
    "$InstallDir\\runtime\\python.exe",
    $cmdPython
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and ($_ -notlike "*\\Microsoft\\WindowsApps\\python.exe") } | Select-Object -Unique
  if ($candidates.Count -gt 0) { return $candidates[0] }
  return $null
}

function Set-Tls {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
  } catch {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  }
}

function Download-File($url, $dst) {
  Set-Tls
  Write-LogLine "Descargando $url"
  Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $dst
}

function Ensure-PythonRuntime {
  $rt = "$InstallDir\\runtime"
  Ensure-Dir $rt
  $py = "$rt\\python.exe"
  if (Test-Path -LiteralPath $py) {
    Write-LogLine "Runtime Python embebido detectado."
    return $py
  }
  $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "win32" }
  $pyVer = "3.12.8"
  $zipName = if ($arch -eq "amd64") { "python-$pyVer-embed-amd64.zip" } else { "python-$pyVer-embed-win32.zip" }
  $url = "https://www.python.org/ftp/python/$pyVer/$zipName"
  $zip = "$InstallDir\\python_embed_$arch.zip"
  Download-File $url $zip
  Write-LogLine "Extrayendo runtime Python..."
  Expand-Archive -Path $zip -DestinationPath $rt -Force
  $pth = Get-ChildItem -Path $rt -Filter "python*._pth" | Select-Object -First 1
  if (-not $pth) { throw "PYTHON_PTH_NOT_FOUND" }
  $pthPath = $pth.FullName
  $content = Get-Content -Path $pthPath -ErrorAction Stop
  $new = @()
  foreach ($line in $content) {
    if ($line -match "^\s*#\s*import\s+site\s*$") { $new += "import site"; continue }
    $new += $line
  }
  if (-not ($new -contains "import site")) { $new += "import site" }
  if (-not ($new -contains "Lib\site-packages")) { $new = @("Lib\site-packages") + $new }
  Set-Content -Path $pthPath -Value $new -Encoding ASCII
  $getPip = "$InstallDir\\get-pip.py"
  Download-File "https://bootstrap.pypa.io/get-pip.py" $getPip
  Write-LogLine "Instalando pip..."
  $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
  $env:PIP_NO_WARN_SCRIPT_LOCATION = "1"
  & $py $getPip --no-warn-script-location | Out-Null
  return $py
}

function Ensure-Dependencies([string]$py) {
  try {
    & $py -c "import flask, flask_cors" 2>$null
    Write-LogLine "OK dependencias presentes."
    return
  } catch {}
  Write-LogLine "Instalando dependencias via pip..."
  & $py -m pip install --upgrade pip | Out-Null
  & $py -m pip install flask flask-cors | Out-Null
  Write-LogLine "OK dependencias instaladas."
}

$InstallDir = "C:\LibreriaPOS"
Ensure-Dir $InstallDir
Ensure-Dir "$InstallDir\logs"
Ensure-Dir "$InstallDir\web"
$global:LogPath = "$InstallDir\logs\doctor_pos_local.log"

$TaskName = "LibreriaPOSLocal"
$PyExe = $null

function Task-Exists {
  $out = & schtasks /query /tn $TaskName 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Install-Task([string]$py) {
  $script = "$InstallDir\local_pos_server.py"
  $action = "`"$py`" `"$script`""
  if (Task-Exists) { & schtasks /delete /tn $TaskName /f 1>$null 2>$null }
  & schtasks /create /tn $TaskName /sc onlogon /rl highest /delay 0000:10 /tr $action /f | Out-Null
  Write-LogLine "Tarea instalada: $TaskName"
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

function Install-WebAssets {
  $base = "https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main"
  Download-File "$base/index.html" "$InstallDir\web\index.html"
  Download-File "$base/style.css" "$InstallDir\web\style.css"
  Download-File "$base/app.js" "$InstallDir\web\app.js"
  Download-File "$base/firebase-config.js" "$InstallDir\web\firebase-config.js"
  Download-File "$base/scanner_utils.js" "$InstallDir\web\scanner_utils.js"
}

function Install-ServerScript {
  $base = "https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main"
  Download-File "$base/local_pos_server.py" "$InstallDir\local_pos_server.py"
}

function Test-Local {
  try {
    $s = Invoke-RestMethod -Uri "http://127.0.0.1:8787/status" -TimeoutSec 2
    Write-LogLine ("OK /status: " + ($s | ConvertTo-Json -Compress))
  } catch {
    Write-LogLine "ERROR /status: $($_.Exception.Message)"
  }
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 2
    Write-LogLine ("OK /health: " + ($h | ConvertTo-Json -Compress))
  } catch {
    Write-LogLine "ERROR /health: $($_.Exception.Message)"
  }
}

Write-LogLine "=== POS Local: $Mode ==="
Write-LogLine "InstallDir=$InstallDir"

if ($Mode -in @("install","start","stop","uninstall")) { Ensure-Admin }

if ($Mode -eq "uninstall") {
  Stop-Task
  Stop-Port 8787
  if (Task-Exists) { & schtasks /delete /tn $TaskName /f 1>$null 2>$null }
  Write-LogLine "Desinstalación OK (tarea y proceso). Carpeta se mantiene: $InstallDir"
  exit 0
}

if ($Mode -eq "stop") {
  Stop-Task
  Stop-Port 8787
  exit 0
}

if ($Mode -eq "start") {
  Start-Task
  Start-Sleep -Seconds 1
  Test-Local
  exit 0
}

if ($Mode -eq "install") {
  Stop-Task
  Stop-Port 8787
  $PyExe = Ensure-PythonRuntime
  Ensure-Dependencies $PyExe
  Install-ServerScript
  Install-WebAssets
  Install-Task $PyExe
  Start-Task
  Start-Sleep -Seconds 1
  Test-Local
  Write-LogLine "INSTALACION_OK"
  exit 0
}

if ($Mode -eq "doctor") {
  Write-LogLine "PID puerto 8787: $(Get-PortPid 8787)"
  Write-LogLine "Python detectado: $(Resolve-Python)"
  Test-Local
  Write-LogLine "Fin doctor. Log: $global:LogPath"
  exit 0
}

