// Regression harness for the Materials-tab race condition.
// Simulates a slow-network device: user opens a course and clicks Materials
// BEFORE the background course sync has finished. Asserts the panel eventually
// shows the materials (and never shows a false "No document files uploaded").
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8933;
const TARGET_URL = process.env.SC_TARGET_URL || `http://127.0.0.1:${PORT}/index.html`;
const IS_LOCAL = !process.env.SC_TARGET_URL;
const CHROME = process.env.CHROME_PATH || ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(candidate => {
  try { execFileSync('which', [candidate], { stdio: 'ignore' }); return true; } catch (_) { return false; }
});
if (!CHROME) {
  console.error('FATAL: no Chrome/Chromium executable found; set CHROME_PATH or install chromium/google-chrome');
  process.exit(2);
}
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'sc-race-profile-' + Date.now());
const DEBUG_PORT = 9225;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  if (!IS_LOCAL) return res.end('remote mode');
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

const proc = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA}`,
  '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

const CDP_URL = `http://127.0.0.1:${DEBUG_PORT}`;
let target = null;
for (let i = 0; i < 40; i++) {
  try { const list = await (await fetch(`${CDP_URL}/json/list`)).json(); target = list.find(t => t.type === 'page'); if (target) break; } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!target) { console.error('FATAL: no CDP target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const consoleLogs = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push((msg.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description ?? '')).join(' '));
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
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('Eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
// Slow the network like a real phone on a weak connection: 1.5s latency,
// so the boot-time sync is still in flight when the user clicks Materials.
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 1500, downloadThroughput: 400 * 1024, uploadThroughput: 400 * 1024
});

await send('Page.navigate', { url: TARGET_URL });
// Wait only for first paint, NOT for sync completion.
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 500));
  const len = await evaluate(`(document.getElementById('app')?.innerHTML || '').length`).catch(() => -1);
  if (len > 100) break;
}

// Immediately: Courses -> first course -> Materials tab (sync still in flight)
const navInfo = await evaluate(`(function(){
  const nav = document.querySelector('[data-nav="courses"]');
  if (nav) nav.click();
  return JSON.stringify({ clicked: !!nav, cardsAfter: document.querySelectorAll('.course-card').length });
})()`);
console.log('NAV:', navInfo);
await new Promise(r => setTimeout(r, 800));
const cardInfo = await evaluate(`(function(){
  const card = document.querySelector('.course-card');
  if (card) card.click();
  return JSON.stringify({ clicked: !!card, cards: document.querySelectorAll('.course-card').length });
})()`);
console.log('CARD:', cardInfo);
await new Promise(r => setTimeout(r, 800));
const viewInfo = await evaluate(`JSON.stringify({ tabs: [...document.querySelectorAll('.course-tab')].map(t=>t.textContent.trim()), appLen: (document.getElementById('app')?.innerHTML||'').length })`);
console.log('VIEW:', viewInfo);
const tabClicked = await evaluate(`(function(){
  const tab = [...document.querySelectorAll('.course-tab')].find(t => t.textContent.trim().toLowerCase() === 'materials');
  if (tab) { tab.click(); return true; } return false;
})()`);
console.log('Materials tab clicked early (sync in flight):', tabClicked);

// Sample the panel over the next 20s: does it ever show materials?
let sawFalseEmpty = false, sawMaterials = false, sawLoading = false, lastText = '';
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 500));
  const info = await evaluate(`(function(){
    const panel = document.querySelector('.panel');
    const text = (panel?.textContent || '').replace(/\\s+/g, ' ');
    return JSON.stringify({
      blocks: document.querySelectorAll('.lecture-block').length,
      falseEmpty: text.includes('No document files uploaded'),
      loading: text.includes('Loading course materials'),
      error: text.includes('could not be loaded')
    });
})()`).catch(() => null);
  if (!info) continue;
  const s = JSON.parse(info);
  if (s.falseEmpty) { sawFalseEmpty = true; lastText = 'FALSE EMPTY: ' + (await evaluate(`document.querySelector('.panel')?.textContent.replace(/\\s+/g,' ').slice(0,200)`)); }
  if (s.blocks > 0) { sawMaterials = true; break; }
  if (s.loading) sawLoading = true;
}

console.log(`RESULT: materialsVisible=${sawMaterials} falseEmptySeen=${sawFalseEmpty} loadingStateSeen=${sawLoading}`);
if (lastText) console.log(lastText);
const titles = await evaluate(`[...document.querySelectorAll('.lecture-block h3')].slice(0,8).map(h=>h.textContent.trim())`).catch(() => []);
if (titles?.length) console.log('TITLES:', JSON.stringify(titles));

const pass = sawMaterials && !(sawFalseEmpty && !sawLoading);
console.log(pass ? '✅ PASS: materials rendered, no false empty state' : '❌ FAIL: false "No document files uploaded" shown for a course that has materials');
console.log('\n--- relevant console ---');
console.log(consoleLogs.filter(l => /sync|materials|error|heal|init/i.test(l)).slice(0, 15).join('\n') || '(none)');

ws.close(); proc.kill(); server.close();
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);
