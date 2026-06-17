param(
  [string]$RemoteUrl = "",
  [string]$Branch = "main",
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$AppRoot = Split-Path -Parent $PSScriptRoot

Push-Location $AppRoot
try {
  node ".\tools\build-static-site.cjs"

  if (-not (Test-Path ".git")) {
    git init
  }

  git branch -M $Branch

  if ($RemoteUrl) {
    $existingRemote = ""
    try {
      $existingRemote = git remote get-url origin 2>$null
    } catch {
      $existingRemote = ""
    }

    if ($existingRemote) {
      if ($existingRemote -ne $RemoteUrl) {
        throw "Current origin is $existingRemote. Confirm manually before changing the remote."
      }
    } else {
      git remote add origin $RemoteUrl
    }
  }

  git add .
  $changes = git status --porcelain
  if ($changes) {
    git commit -m "Publish static comic reader"
  } else {
    Write-Host "No file changes to commit."
  }

  if ($NoPush) {
    Write-Host "Stopped after local commit because -NoPush was provided."
    return
  }

  $remote = ""
  try {
    $remote = git remote get-url origin 2>$null
  } catch {
    $remote = ""
  }

  if (-not $remote) {
    throw "Missing origin remote. Create a GitHub repository, then run: powershell -ExecutionPolicy Bypass -File .\tools\Publish-GitHubPages.ps1 -RemoteUrl https://github.com/<username>/<repo>.git"
  }

  git push -u origin $Branch
  Write-Host "Pushed. In GitHub Settings -> Pages, use GitHub Actions or branch $Branch with /docs."
} finally {
  Pop-Location
}
