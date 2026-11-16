param(
  [string]$Version = (Get-Date -Format 'yyyyMMdd-HHmm'),
  [string]$OutRoot = ""
)

$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if ([string]::IsNullOrWhiteSpace($OutRoot)) {
  $OutRoot = Join-Path $projectRoot 'releases'
}

$target = Join-Path $OutRoot $Version
New-Item -ItemType Directory -Force -Path $target | Out-Null

Copy-Item -Recurse -Force (Join-Path $projectRoot 'apps\api\dist') (Join-Path $target 'api')
Copy-Item -Recurse -Force (Join-Path $projectRoot 'apps\web\dist') (Join-Path $target 'web')
Copy-Item -Recurse -Force (Join-Path $projectRoot 'apps\api\src\infrastructure\db\migrations') (Join-Path $target 'migrations')
Copy-Item -Force (Join-Path $projectRoot 'package.json') (Join-Path $target 'package.json')
Copy-Item -Force (Join-Path $projectRoot 'package-lock.json') (Join-Path $target 'package-lock.json')

$certs = Join-Path $projectRoot '_private\certs'
if (Test-Path $certs) {
  Copy-Item -Recurse -Force $certs (Join-Path $target 'certs')
}

$sums = Get-ChildItem $target -Recurse -File |
  Get-FileHash -Algorithm SHA256 |
  ForEach-Object { '{0}  {1}' -f $_.Hash, (Resolve-Path -Relative $_.Path) }

$sums | Set-Content (Join-Path $target 'SHA256SUMS')
Write-Output ("release created: " + $target)
Write-Output 'next: copy node_modules (npm ci --omit=dev) or install offline on target host'
