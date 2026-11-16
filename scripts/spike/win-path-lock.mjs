import { spawn } from 'node:child_process';
import { access, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('tmp/spike-win-path');
const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  checks: [],
};

function record(name, data) {
  report.checks.push({ name, ...data });
}

async function readLongPath() {
  const segments = Array.from(
    { length: 14 },
    (_, i) => `seg-${String(i).padStart(2, '0')}-${'x'.repeat(18)}`,
  );
  const dir = path.join(root, ...segments);
  const fileName = `${'a'.repeat(180)}.txt`;
  const filePath = path.join(dir, fileName);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, 'long-path-probe', 'utf8');
  const info = await stat(filePath);
  const readBack = await access(filePath)
    .then(() => true)
    .catch(() => false);
  record('long-path-write-read', {
    pathLength: filePath.length,
    exceededLegacy260: filePath.length > 260,
    sizeBytes: info.size,
    readable: readBack,
  });
}

async function renameWhileLocked() {
  const src = path.join(root, 'locked-source.txt');
  const dst = path.join(root, 'locked-target.txt');
  await writeFile(src, 'lock-probe', 'utf8');

  const handle = await open(src, 'r');
  const firstAttempt = { succeeded: false, errorCode: null };
  try {
    await rename(src, dst);
    firstAttempt.succeeded = true;
  } catch (error) {
    firstAttempt.errorCode = error.code ?? error.name;
  }
  await handle.close();

  const retry = { applicable: !firstAttempt.succeeded, attempts: 0, succeeded: false };
  if (!firstAttempt.succeeded) {
    for (let i = 1; i <= 5; i += 1) {
      retry.attempts = i;
      try {
        await rename(src, dst);
        retry.succeeded = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100 * i));
      }
    }
  }

  const moved = await access(dst)
    .then(() => true)
    .catch(() => false);
  record('rename-while-open-handle', {
    firstAttemptSucceeded: firstAttempt.succeeded,
    firstAttemptErrorCode: firstAttempt.errorCode,
    renamedTargetExists: moved,
    retry,
  });
}

async function caseSensitivity() {
  const upper = path.join(root, 'CaseProbe.txt');
  const lower = path.join(root, 'caseprobe.txt');
  await writeFile(upper, 'case', 'utf8');
  const lowerReachable = await access(lower)
    .then(() => true)
    .catch(() => false);
  record('ntfs-case-behavior', { sameFileReachableViaLowerCase: lowerReachable });
}

async function deleteWhileLocked() {
  const target = path.join(root, 'delete-locked.txt');
  await writeFile(target, 'delete-probe', 'utf8');
  const handle = await open(target, 'r');
  const deleteResult = { callSucceeded: false, errorCode: null };
  try {
    await rm(target);
    deleteResult.callSucceeded = true;
  } catch (error) {
    deleteResult.errorCode = error.code ?? error.name;
  }
  const presentWhileOpen = await access(target)
    .then(() => true)
    .catch(() => false);
  await handle.close();
  const presentAfterClose = await access(target)
    .then(() => true)
    .catch(() => false);
  record('delete-while-open-handle', {
    ...deleteResult,
    presentWhileHandleOpen: presentWhileOpen,
    presentAfterHandleClosed: presentAfterClose,
  });
}

function startExternalExclusiveHolder(filePath) {
  const escaped = filePath.replace(/'/g, "''");
  const command = `$fs=[System.IO.File]::Open('${escaped}','Open','ReadWrite','None'); Start-Sleep -Milliseconds 3000; $fs.Dispose()`;
  return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function deleteWhileExternallyLocked() {
  const target = path.join(root, 'exclusive-lock.txt');
  await writeFile(target, 'exclusive-probe', 'utf8');
  const holder = startExternalExclusiveHolder(target);
  await new Promise((resolve) => setTimeout(resolve, 800));

  const firstAttempt = { succeeded: false, errorCode: null };
  try {
    await rm(target);
    firstAttempt.succeeded = true;
  } catch (error) {
    firstAttempt.errorCode = error.code ?? error.name;
  }

  const retry = { attempts: 0, succeeded: false };
  if (!firstAttempt.succeeded) {
    for (let i = 1; i <= 20; i += 1) {
      retry.attempts = i;
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        await rm(target);
        retry.succeeded = true;
        break;
      } catch {
        /* 仍在占用，继续重试 */
      }
    }
  }

  const holderExit = new Promise((resolve) => holder.once('exit', resolve));
  await Promise.race([holderExit, new Promise((resolve) => setTimeout(resolve, 6000))]);
  const removed = await access(target)
    .then(() => false)
    .catch(() => true);

  record('delete-while-externally-locked', {
    firstAttempt,
    retry,
    fileRemoved: removed,
  });
}

try {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await readLongPath();
  await renameWhileLocked();
  await caseSensitivity();
  await deleteWhileLocked();
  await deleteWhileExternallyLocked();
} catch (error) {
  record('unexpected-failure', { message: error.message, code: error.code ?? null });
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
}

const failed = report.checks.filter(
  (c) => c.name === 'unexpected-failure' || (c.name === 'long-path-write-read' && !c.readable),
);
process.exitCode = failed.length > 0 ? 1 : 0;
