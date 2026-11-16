# VaultDeck offline package installer (non-admin part).
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 -TargetHome <VAULTDECK_HOME>
# Admin steps (service registration, firewall, machine cert, machine env vars) are printed at the end.
param(
  [Parameter(Mandatory = $true)][string]$TargetHome
)

$ErrorActionPreference = 'Stop'
$PackageDir = $PSScriptRoot

if (-not (Test-Path (Join-Path $PackageDir 'VERSION'))) { throw 'install.ps1 must run from the package root (VERSION file missing)' }
if (-not (Test-Path (Join-Path $PackageDir 'current\api\main.js'))) { throw 'package is incomplete: current\api\main.js missing' }

$version = (Get-Content (Join-Path $PackageDir 'VERSION') -First 1).Trim()
Write-Output "installing version $version to $TargetHome"

foreach ($dir in @('releases', 'current', 'runtime', 'tools', 'data\storage', 'data\previews', 'logs', 'secrets', 'certs')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $TargetHome $dir) | Out-Null
}

function Copy-Into($src, $dst) {
  robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src -> $dst" }
}

# immutable copy for rollback, then live copy
Copy-Into $PackageDir (Join-Path $TargetHome ("releases\" + $version))
Copy-Into (Join-Path $PackageDir 'current') (Join-Path $TargetHome 'current')
Copy-Into (Join-Path $PackageDir 'runtime') (Join-Path $TargetHome 'runtime')
Copy-Into (Join-Path $PackageDir 'tools') (Join-Path $TargetHome 'tools')
if (Test-Path (Join-Path $PackageDir 'certs')) { Copy-Into (Join-Path $PackageDir 'certs') (Join-Path $TargetHome 'certs') }

Set-Content -Path (Join-Path $TargetHome 'current.txt') -Value $version
Write-Output "current.txt -> $version"

Write-Output ''
Write-Output '=== ADMIN STEPS (run an elevated PowerShell) ==='
Write-Output '1) machine env vars:'
Write-Output '     setx /M VAULTDECK_HOME "' + $TargetHome + '"'
Write-Output '     setx /M VAULTDECK_DB_URL "<connection string, local only>"'
Write-Output '2) migrations (elevated shell with VAULTDECK_DB_URL set):'
Write-Output ('     set VD_MIGRATIONS_DIR=' + $TargetHome + '\current\migrations')
Write-Output ('     "' + $TargetHome + '\runtime\node\node.exe" "' + $TargetHome + '\current\api\infrastructure\db\migrate-cli.js"')
Write-Output '3) register services (WinSW, from %VAULTDECK_HOME%\current):'
Write-Output ('     "' + $TargetHome + '\tools\winsw\WinSW.NET461.exe" install "' + $TargetHome + '\current\vaultdeck-api.xml"')
Write-Output ('     "' + $TargetHome + '\tools\winsw\WinSW.NET461.exe" install "' + $TargetHome + '\current\vaultdeck-web.xml"')
Write-Output '4) firewall (8443/TCP only):'
Write-Output '     New-NetFirewallRule -DisplayName "VaultDeck HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow'
Write-Output '5) optional: import certs\ca.crt into machine Trusted Root store'
Write-Output '6) start: net start vaultdeck-api ; net start vaultdeck-web'
Write-Output '7) smoke: https://<host>:8443/  and  /api/v1/system/health'
Write-Output ''
Write-Output 'install done (non-admin part).'
