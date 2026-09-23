/* Dev-panel gate probe: the environment panel must be invisible for normal
 * (non-fullscreen / touch / embedded) users even when TAB is pressed, must
 * open via the TAB handler when the gate class is legitimately set, and must
 * close on the next TAB press. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8978, DEBUG_PORT = 9278;
const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) throw new Error('Chromium required');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/campus-twin.html';
  const file = path.resolve(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const browser = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--disable-gpu', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/devpanel-${Date.now()}`,
  '--window-size=1280,800', 'about:blank'
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 240 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) throw new Error('no CDP page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description); };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const evalRetry = async (expression, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try { const v = await evaluate(expression); if (v !== null && v !== undefined) return v; } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error('evalRetry exhausted');
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?debug=1` });
await evalRetry(`window.DavisTwin && document.getElementById('panel') ? true : null`);

await evaluate(`(() => {
  const p = document.getElementById('panel');
  const orig = p.classList.toggle.bind(p.classList);
  window.__TRACE = [];
  p.classList.toggle = function (name, force) {
    window.__TRACE.push({ name, force, stack: new Error().stack.split('\\n').slice(1, 5).join(' | ') });
    return orig(name, force);
  };
  return true;
})()`);

const state = () => evaluate(`(() => {
  const p = document.getElementById('panel');
  return { hidden: getComputedStyle(p).visibility === 'hidden', closed: p.classList.contains('closed'), gate: document.body.classList.contains('devPanelOpen'), focused: document.activeElement && p.contains(document.activeElement) };
})()`);

let s = await state();
console.log('BOOT', JSON.stringify(s));
if (!s.hidden || !s.closed || s.gate) throw new Error('panel is not dev-gated at boot');

/* TAB press without fullscreen: nothing may open. */
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await new Promise((r) => setTimeout(r, 250));
s = await state();
console.log('TAB-NON-FS', JSON.stringify(s));
console.log('TRACE', JSON.stringify(await evaluate('window.__TRACE')));
if (!s.hidden || !s.closed || s.gate) throw new Error('panel opened without fullscreen+keyboard');

/* Simulate the legitimate fullscreen+keyboard environment, then TAB: opens. */
await evaluate(`(() => { document.body.classList.add('devPanelOpen'); return true; })()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await new Promise((r) => setTimeout(r, 250));
s = await state();
console.log('TAB-GATED-OPEN', JSON.stringify(s));
if (s.hidden || !s.gate) throw new Error('TAB did not open the gated panel');

/* Second TAB press closes it again. */
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 });
await new Promise((r) => setTimeout(r, 250));
s = await state();
console.log('TAB-CLOSE', JSON.stringify(s));
if (!s.closed) throw new Error('second TAB press did not close the panel');

/* Removing the gate (leaving fullscreen) hides the panel again. */
await evaluate(`(() => { document.body.classList.remove('devPanelOpen'); return true; })()`);
s = await state();
console.log('GATE-REMOVED', JSON.stringify(s));
if (!s.hidden) throw new Error('panel still visible after the gate cleared');

if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 3)); process.exitCode = 1; }
ws.close(); browser.kill('SIGKILL'); server.close();
console.log(process.exitCode ? 'DEV PANEL FAIL' : 'DEV PANEL PASS');
