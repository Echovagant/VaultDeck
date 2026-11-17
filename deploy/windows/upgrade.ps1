# VaultDeck upgrade: install a new package version into an existing VAULTDECK_HOME and restart services.
# Usage (elevated recommended): powershell -ExecutionPolicy Bypass -File upgrade.ps1 -TargetHome <home> -PackageDir <new package>
param(
  [Parameter(Mandatory = $true)][string]$TargetHome,
  [Parameter(Mandatory = $true)][string]$PackageDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $PackageDir 'VERSION'))) { throw 'PackageDir must contain VERSION' }
$version = (Get-Content (Join-Path $PackageDir 'VERSION') -First 1).Trim()
Write-Output "upgrading to version $version"

function Copy-Into($src, $dst) {
  robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src -> $dst" }
}

New-Item -ItemType Directory -Force -Path (Join-Path $TargetHome 'releases') | Out-Null
Copy-Into $PackageDir (Join-Path $TargetHome ("releases\" + $version))
Copy-Into (Join-Path $PackageDir 'current') (Join-Path $TargetHome 'current')
Copy-Into (Join-Path $PackageDir 'runtime') (Join-Path $TargetHome 'runtime')
Copy-Into (Join-Path $PackageDir 'tools') (Join-Path $TargetHome 'tools')
# refresh WinSW per-service configs (executables stay in tools\winsw)
foreach ($svc in @('vaultdeck-api', 'vaultdeck-web')) {
  Copy-Item (Join-Path $TargetHome ("current\" + $svc + '.xml')) (Join-Path $TargetHome ("tools\winsw\" + $svc + '.xml')) -Force
}
Set-Content -Path (Join-Path $TargetHome 'current.txt') -Value $version

Write-Output 'restarting services...'
net stop vaultdeck-api 2>$null | Out-Null
net stop vaultdeck-web 2>$null | Out-Null
net start vaultdeck-web | Out-Null
net start vaultdeck-api | Out-Null
Write-Output "upgrade done: current.txt -> $version"
Write-Output 'smoke: /api/v1/system/health and web page'
