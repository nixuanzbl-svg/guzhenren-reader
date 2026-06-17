$ErrorActionPreference = "Stop"

$sessionPath = Join-Path $PSScriptRoot "public-reader.session.json"
if (-not (Test-Path -LiteralPath $sessionPath)) {
  Write-Host "No public reader session file found."
  exit 0
}

$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
$pids = @($session.tunnelPid, $session.localServerPid) | Where-Object { $_ }

foreach ($pidValue in $pids) {
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $pidValue
    Write-Host "Stopped process $pidValue"
  }
}

Write-Host "Public reader processes stopped. Session file kept at $sessionPath"
