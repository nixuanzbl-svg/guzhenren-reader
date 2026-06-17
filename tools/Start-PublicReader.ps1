param(
  [int]$Port = 8787,
  [switch]$NoDownload
)

$ErrorActionPreference = "Stop"

$toolsRoot = $PSScriptRoot
$readerRoot = Resolve-Path (Join-Path $toolsRoot "..\web")
$projectRoot = Resolve-Path (Join-Path $toolsRoot "..\..\..")
$pdfRoot = Join-Path $projectRoot.Path "pdf"
$readerServerPath = Join-Path $toolsRoot "reader_server.py"
$passwordPath = Join-Path $toolsRoot "admin-password.local.txt"
$cloudflaredPath = Join-Path $toolsRoot "cloudflared.exe"
$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$sessionPath = Join-Path $toolsRoot "public-reader.session.json"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$serverStdoutLog = Join-Path $toolsRoot "reader-server-$stamp.out.log"
$serverStderrLog = Join-Path $toolsRoot "reader-server-$stamp.err.log"
$stdoutLog = Join-Path $toolsRoot "public-reader-$stamp.out.log"
$stderrLog = Join-Path $toolsRoot "public-reader-$stamp.err.log"

function Get-ReaderPython {
  $bundled = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $bundled) {
    return $bundled
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return $py.Source
  }

  throw "Python was not found. Install Python or run this from Codex so the bundled runtime is available."
}

function Test-ReaderLocalUrl {
  param([int]$TestPort)

  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TestPort/api/chapters" -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Ensure-AdminPassword {
  param([string]$PasswordFile)

  if (Test-Path -LiteralPath $PasswordFile) {
    $existing = (Get-Content -LiteralPath $PasswordFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($existing) {
      Write-Host "Developer password file: $PasswordFile"
      return
    }
  }

  $bytes = New-Object byte[] 18
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $password = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  [System.IO.File]::WriteAllText($PasswordFile, $password + [Environment]::NewLine, [System.Text.Encoding]::ASCII)
  Write-Host "Created developer password file: $PasswordFile"
  Write-Host "Developer password:"
  Write-Host $password
}

function Get-ReaderPortPid {
  param([int]$TestPort)

  try {
    $connection = Get-NetTCPConnection -LocalPort $TestPort -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq "127.0.0.1" -or $_.LocalAddress -eq "0.0.0.0" -or $_.LocalAddress -eq "::" } |
      Select-Object -First 1
    if ($connection) {
      return $connection.OwningProcess
    }
  } catch {
    return $null
  }

  return $null
}

if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  if ($NoDownload) {
    throw "cloudflared.exe was not found at $cloudflaredPath and -NoDownload was set."
  }

  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredPath
}

$pythonPath = Get-ReaderPython
Ensure-AdminPassword -PasswordFile $passwordPath
$localServerProcess = $null
$localServerPid = $null

if (Test-ReaderLocalUrl -TestPort $Port) {
  Write-Host "Local reader is already available at http://127.0.0.1:$Port/"
  $localServerPid = Get-ReaderPortPid -TestPort $Port
} else {
  $busyPid = Get-ReaderPortPid -TestPort $Port
  if ($busyPid) {
    throw "Port $Port is already in use by process $busyPid, but the comic reader API is not responding. Run Stop-PublicReader.ps1 or choose another -Port."
  }

  Write-Host "Starting local reader server on http://127.0.0.1:$Port/"
  $pythonArgs = @(
    $readerServerPath,
    "--host", "127.0.0.1",
    "--port", "$Port",
    "--reader-root", $readerRoot.Path,
    "--pdf-root", $pdfRoot,
    "--password-file", $passwordPath
  )
  $localServerProcess = Start-Process -FilePath $pythonPath -ArgumentList $pythonArgs -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog -WindowStyle Hidden -PassThru
  $localServerPid = $localServerProcess.Id

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 300
    if (Test-ReaderLocalUrl -TestPort $Port) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Local reader server did not become ready on port $Port. Check logs: $serverStderrLog"
  }
}

Write-Host "Starting Cloudflare Quick Tunnel..."
$tunnelArgs = @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port")
$tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList $tunnelArgs -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru

$publicUrl = $null
for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $combined = ""
  if (Test-Path -LiteralPath $stdoutLog) {
    $combined += Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $stderrLog) {
    $combined += "`n"
    $combined += Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
  }

  $match = [regex]::Match($combined, "https://[-a-z0-9]+\.trycloudflare\.com")
  if ($match.Success) {
    $publicUrl = $match.Value
    break
  }

  if ($tunnelProcess.HasExited) {
    throw "cloudflared exited before creating a public URL. Check logs: $stderrLog"
  }
}

if (-not $publicUrl) {
  throw "Timed out waiting for a trycloudflare.com URL. Check logs: $stderrLog"
}

$session = [pscustomobject]@{
  publicUrl = $publicUrl
  localUrl = "http://127.0.0.1:$Port/"
  port = $Port
  readerRoot = $readerRoot.Path
  pdfRoot = $pdfRoot
  readerServerPath = $readerServerPath
  passwordPath = $passwordPath
  localServerPid = $localServerPid
  tunnelPid = $tunnelProcess.Id
  cloudflaredPath = $cloudflaredPath
  serverStdoutLog = $serverStdoutLog
  serverStderrLog = $serverStderrLog
  stdoutLog = $stdoutLog
  stderrLog = $stderrLog
  startedAt = (Get-Date).ToString("o")
}

$session | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $sessionPath -Encoding UTF8

Write-Host ""
Write-Host "Public reader URL:"
Write-Host $publicUrl
Write-Host ""
Write-Host "Open this URL from phone or computer. The PC must stay on while the tunnel is running."
Write-Host "Session file: $sessionPath"
