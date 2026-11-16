param(
  [Parameter(Mandatory)][string]$AppHome,
  [Parameter(Mandatory)][string]$DatabaseUrl,
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][string]$PasswordFile,
  [string]$StoragePath = '',
  [string]$PgBin = 'pg_dump',
  [string]$ResticPath = 'restic',
  [int]$KeepDaily = 7,
  [int]$KeepWeekly = 4,
  [int]$KeepMonthly = 6
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($StoragePath)) {
  $StoragePath = Join-Path $AppHome '_private\storage'
}

$env:RESTIC_REPOSITORY = $Repository
$env:RESTIC_PASSWORD_FILE = $PasswordFile

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpDir = Join-Path $AppHome '_private\backups\tmp'
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null

$dumpFile = Join-Path $dumpDir "vaultdeck-$stamp.dump"
$startedAt = Get-Date

Write-Output "[1/4] pg_dump -> $dumpFile"
& $PgBin "--dbname=$DatabaseUrl" --format=custom "--file=$dumpFile"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

Write-Output "[2/4] restic backup (database dump + object storage)"
& $ResticPath backup $dumpDir $StoragePath --tag vaultdeck --host vaultdeck
if ($LASTEXITCODE -ne 0) { throw "restic backup failed with exit code $LASTEXITCODE" }

Write-Output "[3/4] apply retention policy"
& $ResticPath forget --keep-daily $KeepDaily --keep-weekly $KeepWeekly --keep-monthly $KeepMonthly --prune
if ($LASTEXITCODE -ne 0) { throw "restic forget failed with exit code $LASTEXITCODE" }

Remove-Item $dumpFile -Force
$elapsed = (Get-Date) - $startedAt

Write-Output "[4/4] done"
Write-Output ("elapsed_seconds=" + [int]$elapsed.TotalSeconds)
Write-Output "backup_stamp=$stamp"
