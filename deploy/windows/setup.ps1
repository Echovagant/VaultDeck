# VaultDeck 一键部署（管理员）：解包、初始化 PostgreSQL、生成密钥与证书、
# 迁移数据库、注册并启动服务。所有生成物只落在部署目录，不会写回仓库。
# 用法（在离线包根目录，以管理员身份运行）：
#   powershell -ExecutionPolicy Bypass -File setup.ps1
# 默认：PackageDir = 脚本所在目录，TargetHome = <PackageDir>\VaultDeck（不存在时自动创建）。
# 可选：
#   -TargetHome <部署目录> -DryRun   指定部署目录 / 只打印计划不做修改
#   -PgPort 55432 -HttpsPort 8443 -HttpPort 80 -ApiPort 3000
#   -ApiServiceName vaultdeck-api -WebServiceName vaultdeck-web -FirewallRulePrefix VaultDeck
#   -RequireClientCert -ClientName phone
#   -ServerDns vaultdeck.local -ServerIp <LAN_IP>
#   -SkipFirewall -SkipServices -SkipMachineEnv -SkipPgService
# 脚本不会重启电脑，也不会删除部署目录以外的文件。
param(
  [string]$PackageDir = '',
  [string]$TargetHome = '',
  [int]$PgPort = 55432,
  [string]$PgServiceName = 'VaultDeckPostgres',
  [int]$HttpsPort = 8443,
  [int]$HttpPort = 80,
  [int]$ApiPort = 3000,
  [string]$ApiServiceName = 'vaultdeck-api',
  [string]$WebServiceName = 'vaultdeck-web',
  [string]$FirewallRulePrefix = 'VaultDeck',
  [switch]$RequireClientCert,
  [string]$ClientName = '',
  [string]$ServerDns = '',
  [string]$ServerIp = '',
  [switch]$SkipFirewall,
  [switch]$SkipServices,
  [switch]$SkipMachineEnv,
  [switch]$SkipPgService,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not $PackageDir) { $PackageDir = $PSScriptRoot }
$PackageDir = (Resolve-Path $PackageDir).Path
if (-not (Test-Path (Join-Path $PackageDir 'VERSION'))) {
  throw "PackageDir 不是离线包根目录（缺 VERSION）：$PackageDir"
}

if (-not $TargetHome) { $TargetHome = Join-Path $PackageDir 'VaultDeck' }
$TargetHome = [IO.Path]::GetFullPath($TargetHome).TrimEnd('\')

foreach ($serviceName in @($ApiServiceName, $WebServiceName, $PgServiceName)) {
  if ($serviceName -notmatch '^[A-Za-z0-9._-]+$') { throw "服务名只能包含字母、数字、点、下划线与短横线：$serviceName" }
}
if ($ApiServiceName -eq $WebServiceName) { throw 'ApiServiceName 与 WebServiceName 不能相同' }

# ---- 路径护栏：只允许写到明确的部署目录，避免误伤系统目录或覆盖用户文件夹 ----
if ($TargetHome -eq $PackageDir) {
  throw "TargetHome 不能等于离线包目录（会覆盖安装包本身）：$TargetHome"
}
$driveRoot = [IO.Path]::GetPathRoot($TargetHome).TrimEnd('\')
if ($TargetHome -eq $driveRoot) {
  throw "TargetHome 不能是磁盘根目录：$TargetHome"
}
$systemRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
$reservedRoots = @($systemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
foreach ($reserved in $reservedRoots) {
  $reserved = [IO.Path]::GetFullPath($reserved).TrimEnd('\')
  if ($TargetHome.StartsWith($reserved + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "TargetHome 不能位于系统目录或 Program Files 下：$TargetHome"
  }
}
if (-not $DryRun -and (Test-Path -LiteralPath $TargetHome)) {
  $entries = @(Get-ChildItem -LiteralPath $TargetHome -Force)
  $looksDeployed = (Test-Path (Join-Path $TargetHome 'current.txt')) -or `
    (Test-Path (Join-Path $TargetHome 'current\api\main.js'))
  if ($entries.Count -gt 0 -and -not $looksDeployed -and -not $Force) {
    throw "目标目录非空且不像 VaultDeck 部署目录：$TargetHome。确认无误请加 -Force 重新执行。"
  }
}

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $DryRun -and -not $isAdmin) {
  throw 'setup.ps1 需要管理员权限（注册 Windows 服务、写防火墙规则、写机器级环境变量、设置目录 ACL），请用“以管理员身份运行”的 PowerShell 执行。'
}

$script:deployStart = Get-Date
$script:totalSteps = 9
$script:currentStep = 0

Write-Output '=============================================='
Write-Output '  VaultDeck 一键部署'
Write-Output '=============================================='
Write-Output ("  离线包    : " + $PackageDir)
Write-Output ("  部署目录  : " + $TargetHome + "（不存在时自动创建）")
Write-Output '  预计耗时  : 3-8 分钟（首次初始化 PostgreSQL 与等待服务启动占大部分）'
Write-Output '  权限要求  : 管理员；仅用于注册服务、写防火墙规则、写机器级环境变量、收紧密钥目录 ACL'
Write-Output '  会修改    : 部署目录、两个 VaultDeck 服务、PostgreSQL 服务、两条 LocalSubnet 防火墙规则、四个机器级环境变量'
Write-Output '  不会      : 重启电脑、删除部署目录以外的文件、把端口开放给公网'
Write-Output '  中断      : 可随时 Ctrl+C；重新执行同一命令可继续，已生成的口令与密钥会复用'
if ($RequireClientCert) {
  Write-Output '  双向 TLS  : 已启用，浏览器/客户端需要安装对应的客户端证书'
}
Write-Output ''

if ($DryRun) {
  Write-Output 'DryRun：以下为计划，不会做任何修改。'
  Write-Output ("  1. 解包 current/runtime/tools 到 " + $TargetHome + "，并在 releases\ 下保留版本快照")
  Write-Output ("  2. 创建 data\pgdata、certs、secrets、logs 等目录，收紧 secrets/certs 的 ACL")
  Write-Output ("  3. 初始化 PostgreSQL 数据目录，监听 127.0.0.1:" + $PgPort + "，注册服务 " + $PgServiceName)
  Write-Output '  4. 生成数据库口令、secrets\encryption.key 与本机 TLS 证书'
  Write-Output ("  5. 执行数据库迁移，空库时创建初始领队 leader（口令写入 secrets\initial-admin.txt）")
  Write-Output ("  6. 注册/启动 " + $ApiServiceName + "、" + $WebServiceName + " 两个 Windows 服务")
  Write-Output ("  7. 放行 TCP " + $HttpsPort + " 与 " + $HttpPort + "（仅 LocalSubnet），API 端口 " + $ApiPort)
  Write-Output '  不重启电脑，不删除部署目录以外的文件。'
  Write-Output '确认后去掉 -DryRun 执行。'
  return
}

function Write-Step([string]$Text) {
  $script:currentStep++
  $elapsed = (Get-Date) - $script:deployStart
  Write-Output ''
  Write-Output ("[{0}/{1}] {2}  (已用 {3:mm\:ss})" -f `
      $script:currentStep, $script:totalSteps, $Text, $elapsed)
  Write-Progress -Activity 'VaultDeck 部署' -Status $Text `
    -PercentComplete ([int](100 * ($script:currentStep - 1) / $script:totalSteps))
}

function New-RandomToken([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-OrCreateSecret([string]$Path, [int]$Bytes) {
  if (Test-Path $Path) {
    return (Get-Content $Path -Raw).Trim()
  }
  $value = New-RandomToken $Bytes
  Set-Content -Path $Path -Value $value -NoNewline -Encoding ASCII
  return $value
}

function Protect-Directory([string]$Path) {
  $user = "$env:USERDOMAIN\$env:USERNAME"
  & icacls $Path /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "${user}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "设置 ACL 失败：$Path" }
}

function Test-PgReady([string]$PgIsReady) {
  & $PgIsReady -h 127.0.0.1 -p $PgPort -q
  return ($LASTEXITCODE -eq 0)
}

function Start-Postgres([string]$PgCtl, [string]$PgData, [string]$LogFile, [string]$PgIsReady) {
  if (Test-PgReady $PgIsReady) { return }
  $command = '"' + $PgCtl + '" -D "' + $PgData + '" -l "' + $LogFile + '" start'
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command }
  if ($result.ReturnValue -ne 0) {
    throw "PostgreSQL 启动失败（WMI ReturnValue=$($result.ReturnValue)），日志：$LogFile"
  }
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-PgReady $PgIsReady) { return }
  }
  throw "PostgreSQL 启动超时，请查看日志：$LogFile"
}

function Ensure-FirewallRule([string]$Name, [int]$Port) {
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    $existingPorts = @((Get-NetFirewallPortFilter -AssociatedNetFirewallRule $existing).LocalPort)
    if ($existingPorts -contains [string]$Port) { return }
    throw "已存在同名防火墙规则 $Name 但端口不同（当前：$($existingPorts -join ',')，期望：$Port）。请先删除该规则，或用 -FirewallRulePrefix 换一个前缀。"
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port `
    -Action Allow -RemoteAddress LocalSubnet | Out-Null
}

function Write-ServiceDefinition([string]$Source, [string]$Destination, [string]$ServiceName) {
  $xml = Get-Content $Source -Raw
  $xml = $xml -replace '<id>[^<]*</id>', "<id>$ServiceName</id>"
  $xml = $xml.Replace('<env name="PORT" value="3000" />',
    ('<env name="PORT" value="' + $ApiPort + '" />'))
  Set-Content -Path $Destination -Value $xml -Encoding UTF8
}

Write-Step '解包到目标目录'
& (Join-Path $PackageDir 'install.ps1') -TargetHome $TargetHome
# install.ps1 内部使用 robocopy；其退出码 1 表示已复制文件，属成功，不能据此判失败。

$secretsDir = Join-Path $TargetHome 'secrets'
$certsDir = Join-Path $TargetHome 'certs'
$dataDir = Join-Path $TargetHome 'data'
$pgData = Join-Path $dataDir 'pgdata'
foreach ($dir in @($secretsDir, $certsDir, $dataDir, (Join-Path $dataDir 'storage'), (Join-Path $dataDir 'previews'))) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Protect-Directory $secretsDir
Protect-Directory $certsDir

$nodeExe = Join-Path $TargetHome 'runtime\node\node.exe'
if (-not (Test-Path $nodeExe)) { throw "离线包缺少 Node 运行时：$nodeExe" }

Write-Step '生成数据库口令与加密密钥'
$adminPassword = Get-OrCreateSecret (Join-Path $secretsDir 'db-admin.pw') 32
$appPassword = Get-OrCreateSecret (Join-Path $secretsDir 'db-app.pw') 32
$encryptionKeyFile = Join-Path $secretsDir 'encryption.key'
if (-not (Test-Path $encryptionKeyFile)) {
  $keyBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($keyBytes) } finally { $rng.Dispose() }
  Set-Content -Path $encryptionKeyFile -Value ([Convert]::ToBase64String($keyBytes)) -NoNewline -Encoding ASCII
}
$dbEnvFile = Join-Path $secretsDir 'db.env'
if (Test-Path $dbEnvFile) {
  $line = (Get-Content $dbEnvFile | Where-Object { $_ -match '^VD_DATABASE_URL=' } | Select-Object -First 1)
  if (-not $line) { throw "db.env 缺少 VD_DATABASE_URL：$dbEnvFile" }
  $dbUrl = $line.Substring($line.IndexOf('=') + 1)
} else {
  $encodedPassword = [uri]::EscapeDataString($appPassword)
  $dbUrl = "postgresql://vaultdeck:$encodedPassword@127.0.0.1:$PgPort/vaultdeck"
  Set-Content -Path $dbEnvFile -Value "VD_DATABASE_URL=$dbUrl" -NoNewline -Encoding ASCII
}

Write-Step '初始化 PostgreSQL'
$pgBin = Join-Path $TargetHome 'tools\postgresql\bin'
foreach ($exe in @('initdb.exe', 'pg_ctl.exe', 'pg_isready.exe', 'psql.exe', 'createdb.exe')) {
  if (-not (Test-Path (Join-Path $pgBin $exe))) {
    throw "离线包缺少 PostgreSQL 运行时组件：$pgBin\$exe"
  }
}
$initdb = Join-Path $pgBin 'initdb.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'
$pgLog = Join-Path $dataDir 'pg.log'

if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  $adminPwFile = Join-Path $secretsDir 'db-admin.pw'
  & $initdb -D $pgData -U postgres -E UTF8 -A scram-sha-256 "--pwfile=$adminPwFile"
  if ($LASTEXITCODE -ne 0) { throw 'initdb 初始化失败' }
  Add-Content -Path (Join-Path $pgData 'postgresql.conf') -Value @"

# VaultDeck managed settings
listen_addresses = '127.0.0.1'
port = $PgPort
password_encryption = 'scram-sha-256'
"@
}
if ($SkipPgService) {
  Start-Postgres $pgCtl $pgData $pgLog $pgIsReady
} else {
  # 注册为 Windows 服务，保证机器重启后数据库自动拉起；服务账户 LocalSystem 有数据目录访问权限。
  $existingPgService = Get-CimInstance Win32_Service -Filter "Name='$PgServiceName'" -ErrorAction SilentlyContinue
  if ($existingPgService -and $existingPgService.PathName -notmatch [regex]::Escape($pgData)) {
    throw "已存在同名服务 $PgServiceName，但指向其他数据目录：$($existingPgService.PathName)。请用 -PgServiceName 指定其他名称。"
  }
  if (Test-PgReady $pgIsReady) {
    & $pgCtl stop -m fast -D $pgData | Out-Null
    Start-Sleep -Seconds 2
  }
  if (-not (Get-Service $PgServiceName -ErrorAction SilentlyContinue)) {
    & $pgCtl register -N $PgServiceName -D $pgData -S auto
    if ($LASTEXITCODE -ne 0) { throw "注册 PostgreSQL 服务失败：$PgServiceName" }
  }
  $pgService = Get-Service $PgServiceName
  if ($pgService.Status -ne 'Running') { Start-Service $PgServiceName }
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-PgReady $pgIsReady) { break }
  }
  if (-not (Test-PgReady $pgIsReady)) {
    throw "PostgreSQL 服务启动超时：$PgServiceName，请查看 $pgLog"
  }
}

$env:PGPASSWORD = $adminPassword
try {
  $roleExists = ((& $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='vaultdeck'" | Out-String).Trim())
  if ($roleExists -ne '1') {
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE vaultdeck LOGIN PASSWORD '$appPassword'"
    if ($LASTEXITCODE -ne 0) { throw '创建数据库账号失败' }
  } else {
    & $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE vaultdeck WITH PASSWORD '$appPassword'"
    if ($LASTEXITCODE -ne 0) { throw '更新数据库账号口令失败' }
  }

  $dbExists = ((& $psql -h 127.0.0.1 -p $PgPort -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='vaultdeck'" | Out-String).Trim())
  if ($dbExists -ne '1') {
    & $createdb -h 127.0.0.1 -p $PgPort -U postgres -O vaultdeck vaultdeck
    if ($LASTEXITCODE -ne 0) { throw '创建 vaultdeck 数据库失败' }
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Step '生成 TLS 证书'
$genCerts = Join-Path $TargetHome 'tools\setup\gen-certs.mjs'
if (-not (Test-Path $genCerts)) { throw "离线包缺少证书生成脚本：$genCerts" }
$serverCert = Join-Path $certsDir 'server.crt'
$serverKey = Join-Path $certsDir 'server.key'
$needServer = (-not (Test-Path $serverCert)) -or (-not (Test-Path $serverKey))
$needClient = $RequireClientCert -and (-not (Test-Path (Join-Path $certsDir 'client-ca.crt')))
if ($needServer -or $needClient) {
  if ($RequireClientCert -and (-not $ClientName)) { $ClientName = 'admin' }
  $certArgs = @($genCerts, '--out', $certsDir, '--force')
  if ($needServer) {
    if ($ServerDns) { $certArgs += @('--server-san', $ServerDns) }
    if ($ServerIp) { $certArgs += @('--server-ip', $ServerIp) }
  } else {
    $certArgs += @('--client-only')
  }
  if ($RequireClientCert -or $needClient) {
    $certArgs += @('--client-name', $ClientName)
  }
  & $nodeExe @certArgs
  if ($LASTEXITCODE -ne 0) { throw '证书生成失败' }
}

$nginxCerts = Join-Path $TargetHome 'tools\nginx\certs'
New-Item -ItemType Directory -Force -Path $nginxCerts | Out-Null
Copy-Item (Join-Path $certsDir 'server.crt') (Join-Path $nginxCerts 'server.crt') -Force
Copy-Item (Join-Path $certsDir 'server.key') (Join-Path $nginxCerts 'server.key') -Force
if (Test-Path (Join-Path $certsDir 'client-ca.crt')) {
  Copy-Item (Join-Path $certsDir 'client-ca.crt') (Join-Path $nginxCerts 'client-ca.crt') -Force
}

Write-Step '写入 Nginx 配置'
$nginxHome = Join-Path $TargetHome 'tools\nginx'
$nginxConf = Join-Path $nginxHome 'conf\nginx.conf'
$content = Get-Content $nginxConf -Raw
$content = $content.Replace('listen 80;', "listen $HttpPort;")
$content = $content.Replace('listen 8443 ssl;', "listen $HttpsPort ssl;")
$content = $content.Replace('https://$host:8443', ('https://$host:' + $HttpsPort))
$content = $content.Replace('proxy_pass http://127.0.0.1:3000;', "proxy_pass http://127.0.0.1:$ApiPort;")
if ($RequireClientCert) {
  if (-not (Test-Path (Join-Path $nginxCerts 'client-ca.crt'))) {
    throw '启用客户端证书需要 certs/client-ca.crt'
  }
  $content = $content.Replace('# ssl_client_certificate ../certs/client-ca.crt;', 'ssl_client_certificate ../certs/client-ca.crt;')
  $content = $content.Replace('# ssl_verify_client optional;', 'ssl_verify_client optional;')
  $content = $content.Replace('# ssl_verify_depth 2;', 'ssl_verify_depth 2;')
  $content = $content.Replace('# proxy_set_header X-Client-Verify $ssl_client_verify;', 'proxy_set_header X-Client-Verify $ssl_client_verify;')
  $content = $content.Replace('# proxy_set_header X-Client-DN $ssl_client_s_dn;', 'proxy_set_header X-Client-DN $ssl_client_s_dn;')
  $content = $content.Replace('# proxy_set_header X-Client-Fingerprint $ssl_client_fingerprint;', 'proxy_set_header X-Client-Fingerprint $ssl_client_fingerprint;')
}
Set-Content -Path $nginxConf -Value $content -Encoding ASCII

Write-Step '写入机器环境变量'
if (-not $SkipMachineEnv) {
  [Environment]::SetEnvironmentVariable('VAULTDECK_HOME', $TargetHome, 'Machine')
  [Environment]::SetEnvironmentVariable('VAULTDECK_DB_URL', $dbUrl, 'Machine')
  [Environment]::SetEnvironmentVariable('VD_ENCRYPTION_KEY_FILE', $encryptionKeyFile, 'Machine')
  if ($RequireClientCert) {
    [Environment]::SetEnvironmentVariable('VD_REQUIRE_CLIENT_CERT', 'true', 'Machine')
  } else {
    [Environment]::SetEnvironmentVariable('VD_REQUIRE_CLIENT_CERT', $null, 'Machine')
  }
} else {
  Write-Output 'skipped machine environment variables'
}

Write-Step '执行数据库迁移'
$env:VD_DATABASE_URL = $dbUrl
$env:VD_MIGRATIONS_DIR = Join-Path $TargetHome 'current\migrations'
& $nodeExe (Join-Path $TargetHome 'current\api\infrastructure\db\migrate-cli.js')
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败' }

# 空库首次部署时创建初始领队；已有账号的库不会被覆盖。
$initialAdminPassword = Get-OrCreateSecret (Join-Path $secretsDir 'initial-admin.pw') 18
$env:VD_BOOTSTRAP_ADMIN_USERNAME = 'leader'
$env:VD_BOOTSTRAP_ADMIN_PASSWORD = $initialAdminPassword
$env:VD_BOOTSTRAP_ADMIN_DISPLAY_NAME = '领队'
$bootstrapOutput = & $nodeExe (Join-Path $TargetHome 'current\api\infrastructure\db\bootstrap-admin-cli.js')
if ($LASTEXITCODE -ne 0) { throw '创建初始领队账号失败' }
$bootstrapJson = ($bootstrapOutput | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
$bootstrap = $bootstrapJson | ConvertFrom-Json
if ($bootstrap.created) {
  Set-Content -Path (Join-Path $secretsDir 'initial-admin.txt') `
    -Value ("username=leader`npassword=" + $initialAdminPassword) -NoNewline -Encoding ASCII
  Write-Output '初始领队账号已创建：leader（口令见 secrets\initial-admin.txt）'
} else {
  Write-Output '数据库中已有账号，跳过初始领队创建'
}

Write-Step '注册并启动服务'
$apiXmlSource = Join-Path $TargetHome 'current\vaultdeck-api.xml'
$webXmlSource = Join-Path $TargetHome 'current\vaultdeck-web.xml'
Write-ServiceDefinition $apiXmlSource (Join-Path $TargetHome ("tools\winsw\" + $ApiServiceName + '.xml')) $ApiServiceName
Write-ServiceDefinition $webXmlSource (Join-Path $TargetHome ("tools\winsw\" + $WebServiceName + '.xml')) $WebServiceName
$serviceNames = @($ApiServiceName, $WebServiceName)

if (-not $SkipServices) {
  foreach ($svc in $serviceNames) {
    $wrapper = Join-Path $TargetHome ("tools\winsw\$svc.exe")
    Copy-Item (Join-Path $TargetHome 'tools\winsw\WinSW.NET461.exe') $wrapper -Force
    if (-not (Get-Service $svc -ErrorAction SilentlyContinue)) {
      & $wrapper install
      if ($LASTEXITCODE -ne 0) { throw "注册服务失败：$svc" }
    }
  }
}

Push-Location $nginxHome
try {
  & (Join-Path $nginxHome 'nginx.exe') -t -c conf\nginx.conf
  if ($LASTEXITCODE -ne 0) { throw 'Nginx 配置校验失败' }
} finally {
  Pop-Location
}

if (-not $SkipServices) {
  foreach ($svc in $serviceNames) {
    $service = Get-Service $svc
    if ($service.Status -eq 'Running') { Restart-Service $svc -Force } else { Start-Service $svc }
  }
}

if (-not $SkipFirewall) {
  Ensure-FirewallRule ($FirewallRulePrefix + ' HTTPS') $HttpsPort
  Ensure-FirewallRule ($FirewallRulePrefix + ' HTTP') $HttpPort
}

Write-Step '冒烟检查'
if ($SkipServices) {
  Write-Output 'skipped service start and smoke check (SkipServices)'
} else {
  $healthy = $false
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $ApiPort + '/api/v1/system/health') -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) { throw ("API 健康检查超时，请查看 logs\" + $ApiServiceName + ".out.log") }

  $httpsCode = & curl.exe -k -s -o NUL -w "%{http_code}" ("https://localhost:" + $HttpsPort + "/api/v1/system/health")
  if ($httpsCode -ne '200') { throw "HTTPS 健康检查失败：HTTP $httpsCode" }
}

Write-Progress -Activity 'VaultDeck 部署' -Completed
$totalElapsed = (Get-Date) - $script:deployStart
Write-Output ''
Write-Output ('VaultDeck 部署完成（耗时 {0:mm\:ss}）' -f $totalElapsed)
Write-Output ("  部署目录 : " + $TargetHome)
Write-Output ("  访问地址 : https://localhost:" + $HttpsPort + "/")
Write-Output ("  PostgreSQL: 127.0.0.1:" + $PgPort + " / vaultdeck")
Write-Output ("  密钥文件 : " + $encryptionKeyFile)
if (Test-Path (Join-Path $secretsDir 'initial-admin.txt')) {
  Write-Output '  初始账号 : leader（口令见 secrets\initial-admin.txt，首次登录后请立即修改）'
}
if ($RequireClientCert) {
  Write-Output ("  客户端证书: " + (Join-Path $certsDir ("client-" + $ClientName + ".crt")))
  Write-Output '  已启用双向 TLS：浏览器/客户端必须安装对应客户端证书。'
}
Write-Output '  数据库口令与加密密钥只保存在 secrets\ 下，请随部署目录一起备份，勿提交到仓库。'
Write-Output ''
Write-Output '本次脚本没有重启电脑，也没有删除部署目录以外的文件。'
if ($SkipServices) {
  Write-Output '（已跳过服务注册，开机自启未配置。）'
} else {
  $autostartNames = $ApiServiceName + ',' + $WebServiceName
  if (-not $SkipPgService) { $autostartNames = $PgServiceName + ',' + $autostartNames }
  Write-Output '开机自启验证（不需要重启机器）：'
  Write-Output ('  Get-Service ' + $autostartNames + ' | Format-Table Name,Status,StartType')
  Write-Output '  StartType 为 Automatic 即表示随 Windows 启动；实际重启验证请在方便时自行安排。'
}
