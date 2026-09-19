// Verifies ALL course Materials tabs on the live (or local) site in one run:
// for each course card: open course → Materials → wait → count materials,
// and fail if a false "No document files uploaded" ever appears.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8937;
const TARGET_URL = process.env.SC_TARGET_URL || `http://127.0.0.1:${PORT}/index.html`;
const IS_LOCAL = !process.env.SC_TARGET_URL;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'sc-all-courses-' + Date.now());
const DEBUG_PORT = 9229;

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

const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find(t => t.type === 'page'); if (target) break; } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!target) { console.error('FATAL: no CDP target'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
});
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: TARGET_URL });
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 500));
  const len = await evaluate(`(document.getElementById('app')?.innerHTML||'').length`).catch(() => -1);
  if (len > 100) break;
}
// Let the boot-time course sync finish so every course has cloud data.
await new Promise(r => setTimeout(r, 6000));

// Navigate to the Courses hub before counting cards (boot lands on Today).
await evaluate(`document.querySelector('[data-nav="courses"]')?.click()`);
await new Promise(r => setTimeout(r, 1000));

const results = [];
const cardCount = await evaluate(`document.querySelectorAll('.course-card').length`);
console.log(`COURSE CARDS: ${cardCount}`);

for (let idx = 0; idx < cardCount; idx++) {
  // Go back to the hub between courses
  await evaluate(`(function(){
    const back = document.getElementById('course-back-btn');
    if (back) { back.click(); return; }
    document.querySelector('[data-nav="courses"]')?.click();
  })()`);
  await new Promise(r => setTimeout(r, 700));

  const code = await evaluate(`(function(){
    const cards = document.querySelectorAll('.course-card');
    const card = cards[${idx}];
    if (!card) return null;
    const label = card.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40);
    card.click();
    return label;
  })()`);
  await new Promise(r => setTimeout(r, 700));

  await evaluate(`(function(){
    const tab = [...document.querySelectorAll('.course-tab')].find(t => t.textContent.trim().toLowerCase() === 'materials');
    if (tab) tab.click();
    return !!tab;
  })()`);

  // Wait up to 15s for materials or an honest terminal state
  let blocks = 0, falseEmpty = false, error = false, loading = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const s = JSON.parse(await evaluate(`(function(){
      const panel = document.querySelector('.panel');
      const text = (panel?.textContent || '').replace(/\\s+/g, ' ');
      return JSON.stringify({
        blocks: document.querySelectorAll('.lecture-block').length,
        falseEmpty: text.includes('No document files uploaded'),
        error: text.includes('could not be loaded'),
        loading: text.includes('Loading course materials')
      });
    })()`));
    blocks = s.blocks; falseEmpty = s.falseEmpty; error = s.error; loading = s.loading;
    if (blocks > 0 || (falseEmpty && !loading) || (error && !loading)) break;
  }
  const titles = await evaluate(`[...document.querySelectorAll('.lecture-block h3')].slice(0,3).map(h=>h.textContent.trim())`).catch(() => []);
  const ok = blocks > 0 || (falseEmpty && !error && !loading); // genuine-empty is acceptable only if no error and hydration done
  results.push({ idx, code, blocks, falseEmpty, error, ok });
  console.log(`${ok && !falseEmpty ? '✅' : '❌'} [${idx}] ${code} → ${blocks} materials${falseEmpty ? ' ⚠️ FALSE-EMPTY TEXT SEEN' : ''}${error ? ' ⚠️ ERROR BANNER' : ''}`);
  if (blocks > 0) console.log(`   sample: ${JSON.stringify(titles)}`);
}

const failed = results.filter(r => !r.ok || r.falseEmpty);
console.log('\n================ LIVE COURSES VERDICT ================');
if (failed.length) { console.log(`❌ ${failed.length} course(s) failed`); ws.close(); proc.kill(); server.close(); try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}; process.exit(1); }
console.log(`✅ ALL ${results.length} COURSES render their Materials on ${TARGET_URL}`);
ws.close(); proc.kill(); server.close();
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
process.exit(0);
