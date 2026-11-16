# Thin wrapper: real packaging logic lives in scripts/release/build-offline-package.mjs
# Usage: powershell -File build-release.ps1 [-Version vX] [-OutRoot releases]  (extra args pass through)
param(
  [string]$Version = '',
  [string]$OutRoot = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$pass = @()
if ($Version) { $pass += @('--version', $Version) }
if ($OutRoot) { $pass += @('--out', $OutRoot) }

& node (Join-Path $projectRoot 'scripts\release\build-offline-package.mjs') @pass
exit $LASTEXITCODE
