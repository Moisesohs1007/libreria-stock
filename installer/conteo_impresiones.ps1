param(
  [ValidateSet("install","update","uninstall","start","stop")][string]$Mode = "install",
  [switch]$Silent,
  [switch]$KeepData,
  [switch]$NoElevate,
  [int]$Port = 5056,
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("INFO","WARN","ERROR")][string]$Level = "INFO"
  )
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  $line = "[$ts][$Level] $Message"
  Write-Host $line
  if ($script:LogPath) {
    try { Add-Content -Path $script:LogPath -Value $line -Encoding UTF8 } catch {}
  }
}

function Ensure-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  $isAdmin = $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) { return }
  if ($script:NoElevate) { throw "Se requieren permisos de administrador." }
  Write-Log "Elevando permisos (UAC)..." "INFO"
  $args = @("-NoProfile","-ExecutionPolicy","Bypass","-File", $PSCommandPath, "-Mode", $script:Mode)
  if ($script:Silent) { $args += "-Silent" }
  if ($script:KeepData) { $args += "-KeepData" }
  if ($script:Port) { $args += @("-Port", $script:Port) }
  if ($script:Token) { $args += @("-Token", $script:Token) }
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $args | Out-Null
  exit 0
}

function Get-InstallRoot {
  return "C:\LibreriaPrintMonitor"
}

function Ensure-Dirs {
  param([string]$Root)
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "backups") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "runtime") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "app") | Out-Null
}

function Try-CreateRestorePoint {
  param([string]$Description)
  try {
    Enable-ComputerRestore -Drive "C:\" | Out-Null
  } catch {}
  try {
    Checkpoint-Computer -Description $Description -RestorePointType "MODIFY_SETTINGS" | Out-Null
    Write-Log "Punto de restauración creado: $Description" "INFO"
    return $true
  } catch {
    Write-Log "No se pudo crear punto de restauración (continuando): $($_.Exception.Message)" "WARN"
    return $false
  }
}

function Backup-Current {
  param([string]$Root)
  $app = Join-Path $Root "app"
  if (-not (Test-Path $app)) { return $null }
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bk = Join-Path (Join-Path $Root "backups") ("app_" + $stamp)
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  Write-Log "Creando backup: $bk" "INFO"
  & robocopy $app $bk /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  return $bk
}

function Restore-Backup {
  param([string]$Root, [string]$BackupPath)
  if (-not $BackupPath) { return }
  $app = Join-Path $Root "app"
  try {
    if (Test-Path $app) { Remove-Item -Recurse -Force $app }
  } catch {}
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  Write-Log "Restaurando backup desde: $BackupPath" "WARN"
  & robocopy $BackupPath $app /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
}

function Set-Tls {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
  } catch {
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  }
}

function Download-File {
  param([string]$Url, [string]$OutFile)
  Set-Tls
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
  Write-Log "Descargando: $Url" "INFO"
  Invoke-WebRequest -Uri $Url -UseBasicParsing -OutFile $OutFile
}

function Expand-Zip {
  param([string]$ZipPath, [string]$DestDir)
  if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
}

function Ensure-PythonRuntime {
  param([string]$Root)
  $rt = Join-Path $Root "runtime"
  $py = Join-Path $rt "python.exe"
  if (Test-Path $py) {
    Write-Log "Runtime Python embebido detectado." "INFO"
    return $py
  }

  $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "win32" }
  $pyVer = "3.12.8"
  $zipName = if ($arch -eq "amd64") { "python-$pyVer-embed-amd64.zip" } else { "python-$pyVer-embed-win32.zip" }
  $url = "https://www.python.org/ftp/python/$pyVer/$zipName"
  $zip = Join-Path $Root ("python_embed_" + $arch + ".zip")

  Download-File -Url $url -OutFile $zip
  Write-Log "Extrayendo runtime Python..." "INFO"
  Expand-Archive -Path $zip -DestinationPath $rt -Force

  $pth = Get-ChildItem -Path $rt -Filter "python*._pth" | Select-Object -First 1
  if (-not $pth) { throw "No se encontró archivo _pth del runtime Python." }
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

  $getPip = Join-Path $Root "get-pip.py"
  Download-File -Url "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
  Write-Log "Instalando pip..." "INFO"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
    $env:PIP_NO_WARN_SCRIPT_LOCATION = "1"
    $pipOut = & $py $getPip --no-warn-script-location 2>&1
    foreach ($l in $pipOut) {
      $msg = "$l".Trim()
      if (-not [string]::IsNullOrWhiteSpace($msg)) { Write-Log $msg "INFO" }
    }
    if ($LASTEXITCODE -ne 0) {
      throw "get-pip.py falló con código $LASTEXITCODE"
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }

  return $py
}

function Ensure-AppFiles {
  param([string]$Root)
  $zipUrl = "https://github.com/Moisesohs1007/libreria-stock/archive/refs/heads/main.zip"
  $zipPath = Join-Path $Root "repo_main.zip"
  $tmp = Join-Path $Root "tmp_repo"

  Download-File -Url $zipUrl -OutFile $zipPath
  Write-Log "Extrayendo paquete de aplicación..." "INFO"
  Expand-Zip -ZipPath $zipPath -DestDir $tmp

  $top = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  if (-not $top) { throw "No se pudo encontrar carpeta raíz del ZIP." }

  $src = Join-Path $top.FullName "print_service"
  if (-not (Test-Path $src)) { throw "No se encontró print_service en el ZIP." }

  $dst = Join-Path (Join-Path $Root "app") "print_service"
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  & robocopy $src $dst /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
}

function Install-Dependencies {
  param([string]$PythonExe, [string]$Root)
  $req = Join-Path (Join-Path (Join-Path $Root "app") "print_service") "requirements.txt"
  if (-not (Test-Path $req)) { throw "No se encontró requirements.txt" }
  Write-Log "Instalando dependencias Python..." "INFO"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
    $env:PIP_NO_WARN_SCRIPT_LOCATION = "1"
    $pipOut = & $PythonExe -m pip install --disable-pip-version-check --no-warn-script-location -r $req 2>&1
    foreach ($l in $pipOut) {
      $msg = "$l".Trim()
      if (-not [string]::IsNullOrWhiteSpace($msg)) { Write-Log $msg "INFO" }
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Instalación de dependencias falló con código $LASTEXITCODE"
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

function Write-RunScript {
  param([string]$Root, [int]$Port, [string]$Token)
  $rt = Join-Path $Root "runtime"
  $py = Join-Path $rt "python.exe"
  $app = Join-Path $Root "app"
  $logs = Join-Path $Root "logs"
  $script = Join-Path $Root "run_service.cmd"
  $tokenLine = ""
  if ($Token) { $tokenLine = "set PRINT_API_TOKEN=$Token" }
  $content = @(
    "@echo off",
    "setlocal",
    "cd /d ""$Root""",
    "set PRINT_HOST=0.0.0.0",
    "set PRINT_PORT=$Port",
    $tokenLine,
    "set PRINT_DB_PATH=%ProgramData%\LibreriaPrintMonitor\print_jobs.sqlite3",
    "set PY_APP_PATH=$app",
    "set PYEXE=$py",
    "if not exist ""$logs"" mkdir ""$logs""",
    "set LOGFILE=$logs\service.log",
    "if not exist ""%PYEXE%"" (echo [ERROR] No existe %PYEXE% & exit /b 1)",
    """%PYEXE%"" -c ""import sys; sys.path.insert(0, r'%PY_APP_PATH%'); from print_service.server import main; main()"" >> ""%LOGFILE%"" 2>&1"
  ) | Where-Object { $_ -ne "" }
  Set-Content -Path $script -Value $content -Encoding ASCII
  Write-Log "Script creado: $script" "INFO"
}

function Install-Task {
  param([string]$Root)
  $task = "LibreriaPrintMonitor"
  $cmd = "cmd /c `"`"$Root\run_service.cmd`"`""
  & schtasks /delete /tn $task /f 2>$null | Out-Null
  $r = & schtasks /create /f /sc onlogon /ru SYSTEM /rl HIGHEST /delay 0000:30 /tn $task /tr $cmd 2>&1
  Write-Log "Tarea programada instalada: $task" "INFO"
}

function Start-Task {
  $task = "LibreriaPrintMonitor"
  try { & schtasks /run /tn $task 2>$null | Out-Null } catch {}
}

function Stop-Task {
  $task = "LibreriaPrintMonitor"
  try { & schtasks /end /tn $task 2>$null | Out-Null } catch {}
}

function Uninstall-All {
  param([string]$Root)
  Stop-Task
  try { & schtasks /delete /tn "LibreriaPrintMonitor" /f 2>$null | Out-Null } catch {}
  if ($script:KeepData) {
    Write-Log "KeepData habilitado: se conserva $Root" "WARN"
    return
  }
  if (Test-Path $Root) {
    Write-Log "Eliminando carpeta: $Root" "INFO"
    Remove-Item -Recurse -Force $Root
  }
}

$script:Mode = $Mode
$script:Silent = [bool]$Silent
$script:KeepData = [bool]$KeepData
$script:NoElevate = [bool]$NoElevate
$script:Port = $Port
$script:Token = $Token

$root = Get-InstallRoot
Ensure-Dirs -Root $root
$script:LogPath = Join-Path (Join-Path $root "logs") "installer.log"

Write-Log "Modo: $Mode" "INFO"
Ensure-Admin

if ($Mode -eq "stop") { Stop-Task; Write-Log "OK stop" "INFO"; exit 0 }
if ($Mode -eq "start") { Start-Task; Write-Log "OK start" "INFO"; exit 0 }
if ($Mode -eq "uninstall") { Uninstall-All -Root $root; Write-Log "OK uninstall" "INFO"; exit 0 }

$rp = Try-CreateRestorePoint -Description "LibreriaPrintMonitor $Mode"
$bk = Backup-Current -Root $root

try {
  Ensure-AppFiles -Root $root
  $pythonExe = Ensure-PythonRuntime -Root $root
  Install-Dependencies -PythonExe $pythonExe -Root $root
  Write-RunScript -Root $root -Port $Port -Token $Token
  Install-Task -Root $root
  Start-Task
  Write-Log "Instalación completada. Health: http://localhost:$Port/api/prints/health" "INFO"
  if (-not $Silent) { Write-Host ""; Read-Host "Enter para cerrar" | Out-Null }
} catch {
  Write-Log "Fallo instalación: $($_.Exception.Message)" "ERROR"
  Restore-Backup -Root $root -BackupPath $bk
  if (-not $Silent) { Write-Host ""; Read-Host "Enter para cerrar" | Out-Null }
  exit 1
}

