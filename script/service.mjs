import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync, realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const entry = join(root, 'server/index.mjs');
const runtime = resolve(process.env.ONTOLOGY_DATA_DIR || join(root, '.runtime'));
const recordFile = join(runtime, 'service.json');
const logFile = join(runtime, 'server.log');
const lock = join(runtime, 'service.lock');
const action = process.argv[2];
const appName = 'ontology-studio-allinone';
let locked = false;

function record() {
  try { return JSON.parse(readFileSync(recordFile, 'utf8')); } catch { return null; }
}
const previous = record();
const port = Number(process.env.ONTOLOGY_PORT || previous?.port || 45991);
const url = `http://127.0.0.1:${port}`;
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Verify the executable and this project's entry point before signalling a PID.
function owned(pid) {
  if (!alive(pid)) return false;
  try {
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    const comm = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
    if (!/(^|\/)node(?:js)?$/.test(comm)) return false;
    const executable = cmd.slice(0, -entry.length).trim();
    if (cmd.endsWith(entry) && [process.execPath, 'node', 'nodejs', comm].includes(executable)) return true;
    // Adopt an existing foreground `npm start` only when its working directory matches.
    if (!/^(?:\S*\/)?node(?:js)? server\/index\.mjs$/.test(cmd)) return false;
    let cwd;
    if (process.platform === 'linux') cwd = realpathSync(`/proc/${pid}/cwd`);
    else if (process.platform === 'darwin') {
      const lines = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n');
      cwd = lines.find(line => line.startsWith('n'))?.slice(1);
    }
    return !!cwd && realpathSync(cwd) === root;
  } catch { return false; }
}
async function health() {
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(800), redirect: 'error' });
    const data = await response.json();
    return response.ok && data.app === appName && Number.isSafeInteger(data.pid) ? data : null;
  } catch { return null; }
}
async function occupied() {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(true); });
  });
}
function save(pid) {
  writeFileSync(recordFile, JSON.stringify({ pid, port, root, runtime, logFile }, null, 2) + '\n', { mode: 0o600 });
}
async function start() {
  const existing = record();
  if (existing && existing.port !== port && alive(existing.pid)) throw Error(`当前数据目录已有端口 ${existing.port} 的服务；请先停止，或另设 ONTOLOGY_DATA_DIR。`);
  const current = await health();
  if (current) {
    if (!owned(current.pid)) throw Error('端口上已有同名平台，但无法核实进程归属；未启动新进程。');
    save(current.pid);
    console.log(`平台已在运行：${url}（PID ${current.pid}）`);
    return;
  }
  const saved = record();
  if (saved && alive(saved.pid)) throw Error(`记录的进程 ${saved.pid} 仍存活，但服务未就绪。请先运行 status.sh 或 stop.sh。`);
  if (await occupied()) throw Error(`端口 ${port} 已被占用，未启动平台。可通过 ONTOLOGY_PORT 指定其他端口。`);
  const fd = openSync(logFile, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [entry], {
      cwd: root, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, ONTOLOGY_PORT: String(port), ONTOLOGY_DATA_DIR: runtime },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } finally { closeSync(fd); }
  child.unref();
  save(child.pid);
  for (let i = 0; i < 60; i++) {
    const ready = await health();
    if (ready?.pid === child.pid) {
      console.log(`启动成功：${url}\nPID：${child.pid}\n日志：${logFile}`);
      return;
    }
    if (!alive(child.pid)) break;
    await delay(200);
  }
  if (owned(child.pid)) process.kill(child.pid, 'SIGTERM');
  if (record()?.pid === child.pid) rmSync(recordFile, { force: true });
  throw Error(`启动未完成，请查看日志：${logFile}`);
}
async function stop() {
  const current = await health(), saved = record();
  if (saved && saved.port !== port && alive(saved.pid)) throw Error(`已有服务记录使用端口 ${saved.port}；请使用相同端口停止。`);
  const pid = current?.pid || (saved?.root === root && saved?.port === port ? saved.pid : null);
  if (!pid || !alive(pid)) {
    if (await occupied()) throw Error(`端口 ${port} 被其他服务占用，未停止任何进程。`);
    rmSync(recordFile, { force: true });
    console.log('平台已停止。');
    return;
  }
  if (!owned(pid)) throw Error(`无法确认 PID ${pid} 属于本工程，未停止任何进程。`);
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 60; i++) {
    if (!alive(pid) || !owned(pid)) {
      rmSync(recordFile, { force: true });
      console.log(`停止成功（PID ${pid}）。模型、快照与评审数据已保留。`);
      return;
    }
    await delay(200);
  }
  throw Error(`进程 ${pid} 尚未退出，未强制结束。请查看日志：${logFile}`);
}
async function status() {
  const current = await health();
  if (current && owned(current.pid)) {
    console.log(`运行中：${url}\nPID：${current.pid}\n日志：${logFile}`);
    return;
  }
  if (current || await occupied()) throw Error(`端口 ${port} 有服务，但无法确认是本工程的健康实例。`);
  const saved = record();
  if (saved && alive(saved.pid)) throw Error(`服务未就绪，记录的进程 ${saved.pid} 仍存活。日志：${logFile}`);
  console.log('平台未运行。');
}
try {
  if (!['start', 'stop', 'restart', 'status'].includes(action)) throw Error('用法：node script/service.mjs start|stop|restart|status');
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('需要 Node.js 24 或更高版本。');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('ONTOLOGY_PORT 必须是 1–65535 之间的端口号。');
  mkdirSync(runtime, { recursive: true });
  if (action !== 'status') {
    try { mkdirSync(lock); locked = true; }
    catch { throw Error(`另一个启停操作正在执行；如上次被强制中断，请确认没有启停操作后移除 ${lock}。`); }
  }
  if (action === 'status') await status();
  if (action === 'start') await start();
  if (action === 'stop') await stop();
  if (action === 'restart') { await stop(); await start(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { if (locked) rmSync(lock, { recursive: true, force: true }); }
