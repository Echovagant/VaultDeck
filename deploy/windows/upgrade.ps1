# VaultDeck upgrade: install a new package version into an existing VAULTDECK_HOME and restart services.
# Usage (elevated recommended): powershell -ExecutionPolicy Bypass -File upgrade.ps1 -TargetHome <home> -PackageDir <new package>
param(
  [Parameter(Mandatory = $true)][string]$TargetHome,
  [Parameter(Mandatory = $true)][string]$PackageDir,
  [string]$ApiServiceName = 'vaultdeck-api',
  [string]$WebServiceName = 'vaultdeck-web'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $PackageDir 'VERSION'))) { throw 'PackageDir must contain VERSION' }
$version = (Get-Content (Join-Path $PackageDir 'VERSION') -First 1).Trim()
Write-Output "upgrading to version $version"

function Copy-Into($src, $dst) {
  robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src -> $dst" }
}

# Snapshot only the versioned payload; whole-package copies are wasteful and can recurse
# when TargetHome is inside PackageDir.
$releaseDir = Join-Path $TargetHome ("releases\" + $version)
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Into (Join-Path $PackageDir 'current') (Join-Path $releaseDir 'current')
Copy-Item (Join-Path $PackageDir 'VERSION') (Join-Path $releaseDir 'VERSION') -Force
Copy-Into (Join-Path $PackageDir 'current') (Join-Path $TargetHome 'current')
Copy-Into (Join-Path $PackageDir 'runtime') (Join-Path $TargetHome 'runtime')
Copy-Into (Join-Path $PackageDir 'tools') (Join-Path $TargetHome 'tools')
# refresh WinSW per-service configs (executables stay in tools\winsw)
$serviceDefs = @(
  @{ Id = $ApiServiceName; Source = 'vaultdeck-api.xml' },
  @{ Id = $WebServiceName; Source = 'vaultdeck-web.xml' }
)
foreach ($def in $serviceDefs) {
  $xml = Get-Content (Join-Path $TargetHome ('current\' + $def.Source)) -Raw
  $xml = $xml -replace '<id>[^<]*</id>', ('<id>' + $def.Id + '</id>')
  Set-Content -Path (Join-Path $TargetHome ('tools\winsw\' + $def.Id + '.xml')) -Value $xml -Encoding UTF8
}
Set-Content -Path (Join-Path $TargetHome 'current.txt') -Value $version

Write-Output 'restarting services...'
net stop $ApiServiceName 2>$null | Out-Null
net stop $WebServiceName 2>$null | Out-Null
net start $WebServiceName | Out-Null
net start $ApiServiceName | Out-Null
Write-Output "upgrade done: current.txt -> $version"
Write-Output 'smoke: /api/v1/system/health and web page'
