// Reproduces the EXACT stuck-forever failure: a network request that never
// responds (half-open socket / proxy stall / AV interception). Before the
// stall-guard, the awaited supabase query pends indefinitely → "Loading
// course materials…" forever (the user's screenshot state). After the fix,
// the deadline fires → one automatic retry on fresh connections → materials.
//
// Simulating a real OS-level half-open socket from JS is not possible, so the
// page's fetch is intercepted at document-start: ALL requests to the Supabase
// REST host hang forever for the first N seconds (window.SC_UNSTALL_AT).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8939;
// Default = LOCAL files (what we're testing). Set SC_TARGET_URL to test the
// deployed site (useful for proving the pre-fix behavior reproduces there).
const TARGET_URL = process.env.SC_TARGET_URL || `http://127.0.0.1:${PORT}/index.html`;
const IS_LOCAL = !process.env.SC_TARGET_URL;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  if (!IS_LOCAL) return res.end('remote mode');
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.resolve(path.join(ROOT, p));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'sc-stall-' + Date.now());
const DEBUG_PORT = 9234;
// Supabase host stays stalled for the first 12s of page life, then heals.
const UNSTALL_AFTER_MS = 12000;

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const logs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push((m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description ?? '')).join(' '));
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 40000);
  });
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

// Document-start fetch interceptor: supabase REST requests hang forever until
// the deadline, exactly like a half-open socket. Requests issued after the
// deadline pass through (fresh-socket retry succeeds).
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.SC_UNSTALL_AT = ${UNSTALL_AFTER_MS};
    const t0 = Date.now();
    const orig = window.fetch.bind(window);
    window.fetch = function(...args) {
      const url = String(args[0] && args[0].url || args[0] || '');
      if (url.includes('vxsphvrvulhbyhqmoeex.supabase.co') && url.includes('/rest/v1/') && Date.now() - t0 < window.SC_UNSTALL_AT) {
        return new Promise(() => {}); // pend forever = OS-level stall
      }
      return orig(...args);
    };
  `
});

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: TARGET_URL });

// Wait for the app to render (still stalled — sync cannot complete yet)
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 500));
  const len = await evaluate(`(document.getElementById('app')?.innerHTML||'').length`).catch(() => -1);
  if (len > 100) break;
}
// Walk to Materials while stalled — reproduces the user's exact sequence
await evaluate(`document.querySelector('[data-nav="courses"]')?.click()`);
await new Promise(r => setTimeout(r, 600));
await evaluate(`document.querySelector('.course-card')?.click()`);
await new Promise(r => setTimeout(r, 600));
await evaluate(`(function(){const t=[...document.querySelectorAll('.course-tab')].find(t=>t.textContent.trim().toLowerCase()==='materials');if(t)t.click();return !!t})()`);
await new Promise(r => setTimeout(r, 2500));

const duringStall = await evaluate(`JSON.stringify({
  loading: (document.querySelector('.panel')?.textContent || '').includes('Loading course materials'),
  error: (document.querySelector('.panel')?.textContent || '').includes('could not be loaded'),
  blocks: document.querySelectorAll('.lecture-block').length
})`);
console.log('DURING STALL (t≈5s):', duringStall);

// Wait through the deadline: 20s guard fires at t≈20s, retry at t≈24s+query
let sawError = false, sawMaterials = false;
for (let i = 0; i < 80; i++) {
  await new Promise(r => setTimeout(r, 500));
  const s = JSON.parse(await evaluate(`JSON.stringify({
    loading: (document.querySelector('.panel')?.textContent || '').includes('Loading course materials'),
    error: (document.querySelector('.panel')?.textContent || '').includes('could not be loaded'),
    stalled: (document.querySelector('.panel')?.textContent || '').includes('stalled with no response'),
    blocks: document.querySelectorAll('.lecture-block').length
  })`).catch(() => '{"blocks":0}'));
  if (s.stalled || s.error) sawError = true;
  if (s.blocks > 0) { sawMaterials = true; break; }
}
console.log('AFTER UNSTALL WINDOW:', JSON.stringify({ sawError, sawMaterials }));
console.log('LOGS:', logs.filter(l => /stall|error|heal|initialized/i.test(l)).join('\n'));

const pass = sawError && sawMaterials;
console.log(pass
  ? '✅ PASS: stall produced an honest timed-out state, auto-retry recovered, materials rendered.'
  : '❌ FAIL: ' + JSON.stringify({ sawError, sawMaterials }));
ws.close(); proc.kill(); server.close();
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);
