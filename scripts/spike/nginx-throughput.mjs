import http from 'node:http';

const url = process.argv[2] ?? 'http://127.0.0.1:18080/files/test.bin';
const concurrency = Number(process.argv[3] ?? 20);
const rangeSize = Number(process.argv[4] ?? 8 * 1024 * 1024);
const rounds = Number(process.argv[5] ?? 3);

function fetchRange(start, end) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const request = http.get(url, { headers: { Range: `bytes=${start}-${end}` } }, (response) => {
      let bytes = 0;
      let firstByteAt = null;
      response.on('data', (chunk) => {
        if (firstByteAt === null) firstByteAt = process.hrtime.bigint();
        bytes += chunk.length;
      });
      response.on('end', () => {
        const finishedAt = process.hrtime.bigint();
        resolve({
          status: response.statusCode,
          bytes,
          totalMs: Number(finishedAt - startedAt) / 1e6,
          ttfbMs: firstByteAt === null ? null : Number(firstByteAt - startedAt) / 1e6,
        });
      });
    });
    request.on('error', (error) => {
      resolve({
        status: 0,
        bytes: 0,
        totalMs: 0,
        ttfbMs: null,
        error: error.code ?? error.message,
      });
    });
    request.setTimeout(60000, () => request.destroy(new Error('timeout')));
  });
}

const results = [];
for (let round = 0; round < rounds; round += 1) {
  const batch = [];
  for (let index = 0; index < concurrency; index += 1) {
    const start = (round * concurrency + index) * rangeSize;
    batch.push(fetchRange(start, start + rangeSize - 1));
  }
  const settled = await Promise.all(batch);
  results.push(...settled);
}

const totalBytes = results.reduce((sum, item) => sum + item.bytes, 0);
const statuses = results.reduce((map, item) => {
  const key = String(item.status);
  map[key] = (map[key] ?? 0) + 1;
  return map;
}, {});
const latencies = results.filter((item) => item.status === 206 || item.status === 200);
const wallMs = Math.max(...latencies.map((item) => item.totalMs), 1);
const ttfb = latencies.map((item) => item.ttfbMs ?? 0).sort((a, b) => a - b);
const p95Index = Math.min(ttfb.length - 1, Math.floor(ttfb.length * 0.95));

console.log(
  JSON.stringify(
    {
      url,
      concurrency,
      rangeSize,
      rounds,
      requests: results.length,
      okRequests: latencies.length,
      statuses,
      totalMB: Number((totalBytes / 1048576).toFixed(1)),
      aggregateMBps: Number((totalBytes / 1048576 / (wallMs / 1000)).toFixed(1)),
      maxLatencyMs: Number(wallMs.toFixed(1)),
      p95TtfbMs: Number((ttfb[p95Index] ?? 0).toFixed(1)),
      errors: results.filter((item) => item.error).slice(0, 5),
    },
    null,
    2,
  ),
);

const failed = results.filter((item) => item.status >= 500 || item.status === 0).length;
process.exitCode = failed > 0 ? 1 : 0;
