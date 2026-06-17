param(
  [string]$Owner = "nixuanzbl-svg",
  [string]$Repo = "guzhenren-reader",
  [string]$Branch = "main",
  [string]$CredentialTarget = ""
)

$ErrorActionPreference = "Stop"
$AppRoot = Split-Path -Parent $PSScriptRoot

function Get-TokenFromCredentialManager {
  param([string]$Target)

  $code = @'
using System;
using System.Runtime.InteropServices;

public static class NativeCredPublish {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr buffer);
}
'@

  if (-not ("NativeCredPublish" -as [type])) {
    Add-Type -TypeDefinition $code
  }

  $ptr = [IntPtr]::Zero
  if (-not [NativeCredPublish]::CredRead($Target, 1, 0, [ref]$ptr)) {
    return ""
  }

  try {
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][NativeCredPublish+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $bytes.Length)
    return ([Text.Encoding]::UTF8.GetString($bytes)).Trim([char]0).Trim()
  } finally {
    [NativeCredPublish]::CredFree($ptr)
  }
}

Push-Location $AppRoot
try {
  node ".\tools\build-static-site.cjs"

  if (-not (Test-Path ".git")) {
    git init
  }
  git branch -M $Branch
  git add .
  $changes = git status --porcelain
  if ($changes) {
    git commit -m "Publish static comic reader"
  } else {
    Write-Host "No file changes to commit."
  }

  if (-not $env:GITHUB_TOKEN) {
    if (-not $CredentialTarget) {
      $CredentialTarget = "GitHub - https://api.github.com/$Owner"
    }
    $token = Get-TokenFromCredentialManager -Target $CredentialTarget
    if (-not $token) {
      throw "Missing GITHUB_TOKEN and no token found in Windows Credential Manager target: $CredentialTarget"
    }
    $env:GITHUB_TOKEN = $token
  }

  $env:GITHUB_OWNER = $Owner
  $env:GITHUB_REPO = $Repo
  $env:GITHUB_BRANCH = $Branch
  node ".\tools\github-api-publish.cjs"

  if (-not (git remote get-url origin 2>$null)) {
    git remote add origin "https://github.com/$Owner/$Repo.git"
  } else {
    git remote set-url origin "https://github.com/$Owner/$Repo.git"
  }

  Write-Host "Repository: https://github.com/$Owner/$Repo"
  Write-Host "Pages URL: https://$Owner.github.io/$Repo/"
} finally {
  Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:GITHUB_OWNER -ErrorAction SilentlyContinue
  Remove-Item Env:GITHUB_REPO -ErrorAction SilentlyContinue
  Remove-Item Env:GITHUB_BRANCH -ErrorAction SilentlyContinue
  Pop-Location
}
