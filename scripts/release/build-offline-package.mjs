// B9 离线发布包构建器：从本仓库构建产物 + 本地离线安装件，组装出可直接安装到
// %VAULTDECK_HOME% 的完整发布目录（current / runtime / tools + 安装脚本 + SHA256SUMS）。
// 用法：node scripts/release/build-offline-package.mjs [--version vX] [--out releases]
//       [--downloads _private/downloads] [--node-version 24.16.0]
//       [--skip-libreoffice] [--no-build]
// 约束：nginx/winsw 的 SHA256 必须与 deploy/windows/versions.md 一致，不匹配立即中止；
//       Node 便携运行时从 npmmirror 二进制镜像下载并用官方 SHASUMS256 校验。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

// 与 deploy/windows/versions.md 保持同步；版本变更须两处同时更新
const EXPECTED_SHA256 = {
  'nginx-1.30.6.zip': 'c6ee35edb0a861063323f709192ae50d1eefaf2ea7d00678bd2b22d8542dc61e',
  'winsw-2.11.0.nupkg': 'b73c6c10ee634a782cb74024a4d802a6214647e44c432a2cc34b360c64f84766',
};
const NODE_MIRROR = 'https://registry.npmmirror.com/-/binary/node';
// 显式用 System32 的 bsdtar（可解 zip）；PATH 里的 GNU tar（Git Bash）不认 zip
const TAR_EXE = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

function log(line) {
  process.stdout.write(`[pack] ${line}\n`);
}

function run(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd ?? ROOT,
      stdio: ['ignore', opts.capture ? 'pipe' : 'inherit', opts.capture ? 'pipe' : 'inherit'],
    });
    let out = '';
    if (opts.capture) {
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
    }
    child.on('exit', (code) => {
      // 3010 = MSI 安装成功但要求重启，离线解包视为成功
      if (code === 0 || code === 3010) return resolve({ code, out });
      reject(new Error(`命令失败(exit=${code})：${command}\n${out.slice(-2000)}`));
    });
    child.on('error', reject);
  });
}

async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(p);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function downloadTo(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载失败 ${url}: HTTP ${response.status}`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

// tar.exe（Windows 10+ 内置 bsdtar）可直接解 zip，比 Expand-Archive 快得多。
// 注意：bsdtar 会把含盘符的绝对路径（F:\...）解析成远程主机（Cannot connect to F），
// 必须用相对路径 + cwd 规避；跨盘时回退 Expand-Archive。
async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  const parent = path.dirname(zipPath);
  const destRel = path.relative(parent, destDir);
  if (!path.isAbsolute(destRel)) {
    await run(`"${TAR_EXE}" -xf "${path.basename(zipPath)}" -C "${destRel}"`, { cwd: parent });
    return;
  }
  await run(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
  );
}

// 在解包目录里找包含 markerRelPath（如 bin/postgres.exe）的目录；
// marker 可能在 root 本层（MSI 管理解包无前缀目录）也可能在一层前缀目录下
async function findDirWith(rootDir, markerRelPath) {
  const markerParts = markerRelPath.split('/');
  if (existsSync(path.join(rootDir, ...markerParts))) return rootDir;
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findDirWith(path.join(rootDir, entry.name), markerRelPath);
    if (found) return found;
  }
  return null;
}

async function copyTree(src, dest) {
  await cp(src, dest, { recursive: true });
}

// 按文件名模式在解包目录里找第一个匹配的文件
async function findFileMatching(rootDir, pattern) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findFileMatching(path.join(rootDir, entry.name), pattern);
    if (found) return found;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const valueOf = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const version = valueOf('--version') ?? `v${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const outRoot = path.resolve(ROOT, valueOf('--out') ?? 'releases');
  const downloadsDir = path.resolve(ROOT, valueOf('--downloads') ?? '_private/downloads');
  const nodeVersion = valueOf('--node-version') ?? '24.16.0';
  const skipLibreOffice = flag('--skip-libreoffice');
  const noBuild = flag('--no-build');

  const staging = path.join(outRoot, `${version}-offline`);
  const tmpRoot = path.join(outRoot, `.tmp-${version}-${Date.now().toString(36)}`);
  const current = path.join(staging, 'current');

  log(`version=${version} out=${staging}`);

  // 1) 校验离线安装件（nginx / winsw 与 versions.md 锁定值比对）
  for (const [name, expected] of Object.entries(EXPECTED_SHA256)) {
    const file = path.join(downloadsDir, name);
    if (!existsSync(file)) throw new Error(`缺少离线安装件：${file}`);
    const actual = await sha256File(file);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`SHA256 不匹配：${name}\n  期望 ${expected}\n  实际 ${actual}`);
    }
    log(`sha256 OK: ${name}`);
  }

  // 2) 构建 api 与 web
  if (!noBuild) {
    log('building @vaultdeck/api ...');
    await run('npm run build --workspace @vaultdeck/api');
    log('building @vaultdeck/web ...');
    await run('npm run build --workspace @vaultdeck/web');
  }
  if (!existsSync(path.join(ROOT, 'apps/api/dist/main.js'))) throw new Error('apps/api/dist/main.js 不存在');
  if (!existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) throw new Error('apps/web/dist/index.html 不存在');

  await mkdir(staging, { recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(current, { recursive: true });

  // 3) current：api 产物 + 生产依赖闭包 + 迁移 + WinSW 服务定义
  await copyTree(path.join(ROOT, 'apps/api/dist'), path.join(current, 'api'));
  await copyTree(path.join(ROOT, 'apps/api/src/infrastructure/db/migrations'), path.join(current, 'migrations'));
  for (const xml of ['vaultdeck-api.xml', 'vaultdeck-web.xml']) {
    await copyTree(path.join(ROOT, 'deploy/windows', xml), path.join(current, xml));
  }
  await copyTree(path.join(ROOT, 'apps/api/package.json'), path.join(current, 'api', 'package.json'));

  log('assembling production node_modules from package-lock ...');
  // 两类条目都要收：根 hoisted（node_modules/*）与 per-workspace 嵌套安装（apps/api/node_modules/*）。
  // 只看根会漏掉被 npm 装进 apps/api 的依赖（如 ajv@8 在根上被 dev 包的 ajv@6 抢了 hoist 位）。
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const prodEntries = [];
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    if (meta.dev || meta.devOptional) continue;
    if (key.startsWith('node_modules/')) {
      if (key.includes('node_modules/@vaultdeck/') || key.endsWith('node_modules/.bin')) continue;
      prodEntries.push([key, path.join('current/api', key)]);
    } else if (key.startsWith('apps/api/node_modules/')) {
      const rel = key.slice('apps/api/'.length);
      if (rel.includes('node_modules/@vaultdeck/') || rel.endsWith('node_modules/.bin')) continue;
      prodEntries.push([key, path.join('current/api', rel)]);
    }
  }
  let copied = 0;
  for (const [key, destRel] of prodEntries) {
    const src = path.join(ROOT, key);
    if (!existsSync(src)) continue;
    await copyTree(src, path.join(staging, destRel));
    copied += 1;
  }
  log(`node_modules packages copied: ${copied}`);

  // 4) runtime/node：便携 Node（npmmirror 镜像 + 官方 SHASUMS256 校验）
  const nodeZipName = `node-v${nodeVersion}-win-x64.zip`;
  const nodeZip = path.join(downloadsDir, nodeZipName);
  if (!existsSync(nodeZip)) {
    log(`downloading ${nodeZipName} from npmmirror ...`);
    await downloadTo(`${NODE_MIRROR}/v${nodeVersion}/${nodeZipName}`, nodeZip);
  }
  const shasums = await (await fetch(`${NODE_MIRROR}/v${nodeVersion}/SHASUMS256.txt`, { redirect: 'follow' })).text();
  const expectedNode = new RegExp(`^([a-f0-9]{64})\\s+${nodeZipName}$`, 'm').exec(shasums)?.[1];
  if (!expectedNode) throw new Error(`SHASUMS256.txt 中找不到 ${nodeZipName}`);
  const actualNode = await sha256File(nodeZip);
  if (actualNode.toLowerCase() !== expectedNode.toLowerCase()) {
    throw new Error(`Node zip SHA256 不匹配\n  期望 ${expectedNode}\n  实际 ${actualNode}`);
  }
  log(`sha256 OK: ${nodeZipName}`);
  const nodeTmp = path.join(tmpRoot, 'node');
  await extractZip(nodeZip, nodeTmp);
  const nodeDir = await findDirWith(nodeTmp, 'node.exe');
  if (!nodeDir) throw new Error('Node 解包后找不到 node.exe');
  await copyTree(nodeDir, path.join(staging, 'runtime/node'));
  log('runtime/node ready');

  // 5) tools/nginx：zip 解包 + conf 替换 + web 产物与证书就位（nginx conf 全部相对路径）
  const nginxTmp = path.join(tmpRoot, 'nginx');
  await extractZip(path.join(downloadsDir, 'nginx-1.30.6.zip'), nginxTmp);
  const nginxDir = await findDirWith(nginxTmp, 'conf/nginx.conf');
  if (!nginxDir) throw new Error('Nginx 解包后找不到 conf/nginx.conf');
  const nginxHome = path.join(staging, 'tools/nginx');
  await copyTree(nginxDir, nginxHome);
  await copyTree(path.join(ROOT, 'deploy/windows/nginx.conf.example'), path.join(nginxHome, 'conf', 'nginx.conf'));
  await copyTree(path.join(ROOT, 'apps/web/dist'), path.join(nginxHome, 'app'));
  const certsDir = path.join(ROOT, '_private/certs');
  if (existsSync(certsDir)) {
    await copyTree(certsDir, path.join(nginxHome, 'certs'));
    await copyTree(certsDir, path.join(staging, 'certs'));
  }
  log('tools/nginx ready (app + certs included)');

  // 6) tools/winsw
  const winswTmp = path.join(tmpRoot, 'winsw');
  await extractZip(path.join(downloadsDir, 'winsw-2.11.0.nupkg'), winswTmp);
  const winswExe = path.join(winswTmp, 'lib', 'net461-full', 'WinSW.NET461.exe');
  if (!existsSync(winswExe)) throw new Error('WinSW nupkg 中找不到 lib/net461-full/WinSW.NET461.exe');
  await mkdir(path.join(staging, 'tools/winsw'), { recursive: true });
  await copyTree(winswExe, path.join(staging, 'tools/winsw/WinSW.NET461.exe'));
  log('tools/winsw ready');

  // 7) tools/libreoffice：msiexec /a 免管理员解包
  if (skipLibreOffice) {
    log('skipping libreoffice (--skip-libreoffice)');
  } else {
    const loMsi = path.join(downloadsDir, 'LibreOffice_26.8.3_Win_x86-64.msi');
    if (!existsSync(loMsi)) throw new Error(`缺少 ${loMsi}`);
    log('extracting LibreOffice via msiexec /a（约 1-3 分钟）...');
    const loTmp = path.join(tmpRoot, 'libreoffice');
    await mkdir(loTmp, { recursive: true });
    await run(`msiexec /a "${loMsi}" /qn TARGETDIR="${loTmp}"`);
    const soffice = await findDirWith(loTmp, 'program/soffice.exe');
    if (!soffice) throw new Error('LibreOffice 解包后找不到 program/soffice.exe');
    await copyTree(soffice, path.join(staging, 'tools/libreoffice'));
    log('tools/libreoffice ready');
  }

  // 8) tools/postgresql + tools/restic
  const pgTmp = path.join(tmpRoot, 'postgresql');
  await extractZip(path.join(downloadsDir, 'postgresql-16.16-windows-x64-binaries.zip'), pgTmp);
  const pgDir = await findDirWith(pgTmp, 'bin/postgres.exe');
  if (!pgDir) throw new Error('PostgreSQL 解包后找不到 bin/postgres.exe');
  await copyTree(pgDir, path.join(staging, 'tools/postgresql'));
  log('tools/postgresql ready');

  const resticTmp = path.join(tmpRoot, 'restic');
  await extractZip(path.join(downloadsDir, 'restic_0.19.1_windows_amd64.zip'), resticTmp);
  // GitHub release 的 zip 里 exe 带版本号（restic_0.19.1_windows_amd64.exe），按模式找
  const resticExe = await findFileMatching(resticTmp, /^restic.*\.exe$/i);
  if (!resticExe) throw new Error('restic 解包后找不到 restic*.exe');
  await mkdir(path.join(staging, 'tools/restic'), { recursive: true });
  await copyTree(resticExe, path.join(staging, 'tools/restic/restic.exe'));
  log('tools/restic ready');

  // 9) 元数据与校验清单
  await writeFile(
    path.join(staging, 'VERSION'),
    `${version}\nbuilt ${new Date().toISOString()}\nnode v${nodeVersion}\n`,
  );
  await writeFile(
    path.join(staging, 'README-INSTALL.txt'),
    [
      'VaultDeck offline package',
      '',
      'Install (non-admin part):',
      '  powershell -ExecutionPolicy Bypass -File install.ps1 -TargetHome <VAULTDECK_HOME>',
      '',
      'Admin steps afterwards (see docs/ops/deployment.md sections 5 and 7):',
      '  1. setx /M VAULTDECK_HOME <VAULTDECK_HOME>',
      '  2. setx /M VAULTDECK_DB_URL <connection string>',
      '  3. migrations:  set VD_MIGRATIONS_DIR=%VAULTDECK_HOME%\\current\\migrations &&',
      '     "%VAULTDECK_HOME%\\runtime\\node\\node.exe" "%VAULTDECK_HOME%\\current\\api\\infrastructure\\db\\migrate-cli.js"',
      '     (VD_DATABASE_URL must be set in the same shell)',
      '  4. WinSW install for vaultdeck-api.xml / vaultdeck-web.xml (in %VAULTDECK_HOME%\\current)',
      '  5. firewall rule for 8443/TCP',
      '  6. import CA cert (machine store, optional)',
      '',
      'Upgrade:  upgrade.ps1 -PackageDir <new package dir>',
      'Rollback: rollback.ps1 -Version <version in releases>',
      '',
      'Smoke check: https://<host>:8443/  and  /api/v1/system/health',
      '',
    ].join('\n'),
  );
  log('hashing package files ...');
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(staging);
  const sums = [];
  for (const file of files) {
    sums.push(`${await sha256File(file)}  ${path.relative(staging, file).replaceAll('\\', '/')}`);
  }
  await writeFile(path.join(staging, 'SHA256SUMS'), `${sums.join('\n')}\n`);

  await rm(tmpRoot, { recursive: true, force: true });
  log(`package ready: ${staging} (${files.length} files)`);
}

main().catch((error) => {
  process.stderr.write(`[pack] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
