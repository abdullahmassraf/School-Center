// DIAGNOSTIC (read-only): trace the live app's exact network behavior for the
// Materials flow. Records every request related to supabase/rest/materials,
// its status, and how long it took; pairs it with console output; then walks
// Courses → MATH 15325D → Materials and reports the exact request timeline.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TARGET_URL = process.env.SC_TARGET_URL || 'https://abdullahmassraf.github.io/School-Center/';
const CHROME = process.env.CHROME_PATH || ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(candidate => {
  try { execFileSync('which', [candidate], { stdio: 'ignore' }); return true; } catch (_) { return false; }
});
if (!CHROME) {
  console.error('FATAL: no Chrome/Chromium executable found; set CHROME_PATH or install chromium/google-chrome');
  process.exit(2);
}
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'sc-nettrace-' + Date.now());
const DEBUG_PORT = 9233;

const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
const requests = []; // {url, status, ms, failed}
const consoleLogs = [];
const t0 = Date.now();

ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') {
    const url = m.params.request.url;
    if (/supabase|rest\/v1|storage\/v1|auth\/v1/.test(url)) {
      requests.push({ url, startedAt: Date.now() - t0, id: m.params.requestId, status: null, ms: null, failed: null });
    }
  } else if (m.method === 'Network.responseReceived') {
    const r = requests.find(x => x.id === m.params.requestId);
    if (r) { r.status = m.params.response.status; r.respondedAt = Date.now() - t0; }
  } else if (m.method === 'Network.loadingFailed') {
    const r = requests.find(x => x.id === m.params.requestId);
    if (r) { r.failed = m.params.errorText; }
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description ?? '')).join(' ');
    consoleLogs.push(`[t+${Date.now() - t0}ms][${m.params.type}] ${text}`);
  }
};

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 30000);
  });
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Page.navigate', { url: TARGET_URL });
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 500));
  const len = await evaluate(`(document.getElementById('app')?.innerHTML||'').length`).catch(() => -1);
  if (len > 100) break;
}
await new Promise(r => setTimeout(r, 3000)); // let boot sync finish

// Walk: Courses → first course (MATH) → Materials
await evaluate(`document.querySelector('[data-nav="courses"]')?.click()`);
await new Promise(r => setTimeout(r, 800));
await evaluate(`document.querySelector('.course-card')?.click()`);
await new Promise(r => setTimeout(r, 800));
await evaluate(`(function(){const t=[...document.querySelectorAll('.course-tab')].find(t=>t.textContent.trim().toLowerCase()==='materials');if(t)t.click();return !!t})()`);
await new Promise(r => setTimeout(r, 8000));

const ui = await evaluate(`JSON.stringify({
  activeTab: document.querySelector('.course-tab.active')?.textContent?.trim(),
  blocks: document.querySelectorAll('.lecture-block').length,
  text: (document.querySelector('.panel')?.textContent || '').replace(/\\s+/g,' ').slice(0, 160)
})`);
console.log('UI:', ui);

console.log('\n=== SUPABASE REQUEST TIMELINE ===');
for (const r of requests) {
  const short = r.url.replace('https://vxsphvrvulhbyhqmoeex.supabase.co', '').slice(0, 90);
  console.log(`t+${r.startedAt}ms → ${short} | status=${r.status ?? 'NEVER RESPONDED'}${r.failed ? ' | failed: ' + r.failed : ''}${r.respondedAt ? ` | responded t+${r.respondedAt}` : ''}`);
}
const stillPending = requests.filter(r => r.status === null && !r.failed);
if (stillPending.length) console.log(`⚠️ ${stillPending.length} request(s) STILL PENDING at end of run:`, stillPending.map(r => r.url.slice(0, 90)).join('\n'));

console.log('\n=== CONSOLE ===');
console.log(consoleLogs.join('\n') || '(none)');

ws.close(); proc.kill();
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
