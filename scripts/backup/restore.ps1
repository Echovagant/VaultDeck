param(
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][string]$PasswordFile,
  [Parameter(Mandatory)][string]$TargetDir,
  [string]$Snapshot = 'latest',
  [string]$Include = '',
  [string]$ResticPath = 'restic'
)

$ErrorActionPreference = 'Stop'

$env:RESTIC_REPOSITORY = $Repository
$env:RESTIC_PASSWORD_FILE = $PasswordFile

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$startedAt = Get-Date

if ([string]::IsNullOrWhiteSpace($Include)) {
  Write-Output "[1/2] restic restore $Snapshot -> $TargetDir"
  & $ResticPath restore $Snapshot --target $TargetDir
} else {
  Write-Output "[1/2] restic restore $Snapshot --include $Include -> $TargetDir"
  & $ResticPath restore $Snapshot --target $TargetDir --include $Include
}

if ($LASTEXITCODE -ne 0) { throw "restic restore failed with exit code $LASTEXITCODE" }

$elapsed = (Get-Date) - $startedAt
Write-Output "[2/2] done"
Write-Output ("elapsed_seconds=" + [int]$elapsed.TotalSeconds)
Write-Output "target=$TargetDir"
