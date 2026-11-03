import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('Service scripts start, reuse, restart, stop and protect unrelated processes', { timeout: 60000 }, async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'ontology-service-'));
  const collision = http.createServer((req, res) => res.end('{"app":"another-service"}'));
  await new Promise(resolve => collision.listen(0, '127.0.0.1', resolve));
  const occupiedPort = collision.address().port;
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, ONTOLOGY_DATA_DIR: runtime, ONTOLOGY_PORT: String(port) };
  const run = (action, variables = env) => exec('/bin/sh', [resolve(root, `script/${action}.sh`)], {
    cwd: tmpdir(), env: variables, timeout: 20000,
  });
  let unrelated, foreground;
  try {
    assert.match((await run('start')).stdout, /启动成功/);
    const first = JSON.parse(readFileSync(join(runtime, 'service.json'), 'utf8'));
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid, first.pid);
    assert.match((await run('start')).stdout, /已在运行/);
    assert.equal(JSON.parse(readFileSync(join(runtime, 'service.json'), 'utf8')).pid, first.pid);
    assert.match((await run('status')).stdout, /运行中/);
    // Port is recovered from the record when it is omitted on subsequent calls.
    const savedEnv = { ...env }; delete savedEnv.ONTOLOGY_PORT;
    assert.match((await run('restart', savedEnv)).stdout, /启动成功/);
    const second = JSON.parse(readFileSync(join(runtime, 'service.json'), 'utf8'));
    assert.equal(second.port, port);
    assert.notEqual(second.pid, first.pid);
    assert.match((await run('stop', savedEnv)).stdout, /停止成功/);
    assert.match((await run('stop')).stdout, /已停止/);
    assert.match((await run('status')).stdout, /未运行/);
    foreground = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, stdio: 'ignore' });
    await new Promise((resolve, reject) => { foreground.once('spawn', resolve); foreground.once('error', reject); });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.ok).catch(() => false);
      if (ready) break;
      await delay(100);
    }
    assert.equal(ready, true);
    assert.match((await run('start')).stdout, /已在运行/);
    assert.match((await run('stop')).stdout, /停止成功/);
    await assert.rejects(run('start', { ...env, ONTOLOGY_PORT: String(occupiedPort) }), /已被占用/);
    assert.equal(collision.listening, true);
    unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
    writeFileSync(join(runtime, 'service.json'), JSON.stringify({ pid: unrelated.pid, root: root.replace(/\/$/, ''), port }));
    await assert.rejects(run('stop'), /无法确认/);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    unrelated?.kill('SIGTERM');
    if (foreground && foreground.exitCode === null) foreground.kill('SIGTERM');
    // Leave a failing test's platform process stopped as well.
    await run('stop').catch(() => null);
    await new Promise(resolve => collision.close(resolve));
    rmSync(runtime, { recursive: true, force: true });
  }
});
