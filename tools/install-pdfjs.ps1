param(
  [string]$Version = "2.16.105"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeModules = Join-Path $ProjectRoot "node_modules"
New-Item -ItemType Directory -Force -Path $NodeModules | Out-Null

function Install-NpmTarball {
  param(
    [string]$Name,
    [string]$PackageVersion
  )

  $PackageDir = Join-Path $NodeModules $Name
  $ArchiveName = "{0}-{1}.tgz" -f $Name.Replace("/", "-"), $PackageVersion
  $ArchivePath = Join-Path $ProjectRoot (Join-Path "tools" $ArchiveName)
  $PackageUrl = "https://registry.npmjs.org/$Name/-/$Name-$PackageVersion.tgz"

  if (Test-Path $PackageDir) {
    Write-Host "$Name already exists: $PackageDir"
    return
  }

  New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

  if (-not (Test-Path $ArchivePath)) {
    Write-Host "Downloading $PackageUrl"
    Invoke-WebRequest -Uri $PackageUrl -OutFile $ArchivePath
  }

  Write-Host "Extracting $Name to $PackageDir"
  tar -xzf $ArchivePath -C $PackageDir --strip-components 1
}

Install-NpmTarball -Name "pdfjs-dist" -PackageVersion $Version
Install-NpmTarball -Name "dommatrix" -PackageVersion "1.0.3"
Install-NpmTarball -Name "web-streams-polyfill" -PackageVersion "3.2.1"

Write-Host "Done. Open WeChat DevTools and run Tools -> Build npm."
