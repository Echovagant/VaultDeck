# VaultDeck rollback: switch current back to a previous release and restart services.
# Usage (elevated recommended): powershell -ExecutionPolicy Bypass -File rollback.ps1 -TargetHome <home> -Version <releases subfolder>
param(
  [Parameter(Mandatory = $true)][string]$TargetHome,
  [Parameter(Mandatory = $true)][string]$Version
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
foreach ($svc in @('vaultdeck-api', 'vaultdeck-web')) {
  Copy-Item (Join-Path $TargetHome ("current\" + $svc + '.xml')) (Join-Path $TargetHome ("tools\winsw\" + $svc + '.xml')) -Force
}
Set-Content -Path (Join-Path $TargetHome 'current.txt') -Value $Version

Write-Output 'restarting services...'
net stop vaultdeck-api 2>$null | Out-Null
net stop vaultdeck-web 2>$null | Out-Null
net start vaultdeck-web | Out-Null
net start vaultdeck-api | Out-Null
Write-Output "rollback done: current.txt -> $Version"
