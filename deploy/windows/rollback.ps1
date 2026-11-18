# VaultDeck rollback: switch current back to a previous release and restart services.
# Usage (elevated recommended): powershell -ExecutionPolicy Bypass -File rollback.ps1 -TargetHome <home> -Version <releases subfolder>
param(
  [Parameter(Mandatory = $true)][string]$TargetHome,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ApiServiceName = 'vaultdeck-api',
  [string]$WebServiceName = 'vaultdeck-web'
)

$ErrorActionPreference = 'Stop'

$releaseCurrent = Join-Path $TargetHome ("releases\" + $Version + "\current")
if (-not (Test-Path $releaseCurrent)) { throw "release not found: $releaseCurrent" }

function Copy-Into($src, $dst) {
  robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src -> $dst" }
}

Write-Output "rollback to version $Version"
Copy-Into $releaseCurrent (Join-Path $TargetHome 'current')
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
Set-Content -Path (Join-Path $TargetHome 'current.txt') -Value $Version

Write-Output 'restarting services...'
net stop $ApiServiceName 2>$null | Out-Null
net stop $WebServiceName 2>$null | Out-Null
net start $WebServiceName | Out-Null
net start $ApiServiceName | Out-Null
Write-Output "rollback done: current.txt -> $Version"
