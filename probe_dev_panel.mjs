/* Developer-panel gate probe. The menu must be focus-inert outside real
 * fullscreen, open only from a trusted TAB keyboard event, remain keyboard
 * navigable once open, and close immediately on Escape/fullscreen exit. */
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
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.obj':'text/plain', '.mtl':'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/campus-twin.html';
  const file = path.resolve(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
for (let i = 0; i < 480 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) throw new Error('no CDP page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args?.map((a) => a.value).join(' ') || 'console error');
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
});
const evaluate = async (expression, extra = {}) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const waitFor = async (expression, tries = 80, delay = 250) => {
  for (let i = 0; i < tries; i++) {
    try { if (await evaluate(expression)) return true; } catch {}
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('waitFor exhausted: ' + expression);
};
const key = async (code, keyName = code) => {
  await send('Input.dispatchKeyEvent', { type:'keyDown', code, key:keyName, windowsVirtualKeyCode: code === 'Tab' ? 9 : code === 'Escape' ? 27 : 0 });
  await send('Input.dispatchKeyEvent', { type:'keyUp', code, key:keyName, windowsVirtualKeyCode: code === 'Tab' ? 9 : code === 'Escape' ? 27 : 0 });
};
const state = () => evaluate(`(() => {
  const p=document.getElementById('panel'),cs=getComputedStyle(p);
  return {
    fullscreen:!!document.fullscreenElement,
    hidden:cs.visibility==='hidden'||cs.display==='none',
    closed:p.classList.contains('closed'),
    gate:document.body.classList.contains('devPanelOpen'),
    inert:p.inert,
    ariaHidden:p.getAttribute('aria-hidden'),
    focused:p.contains(document.activeElement),
    focusId:document.activeElement?.id||document.activeElement?.getAttribute?.('data-season')||document.activeElement?.tagName||null
  };
})()`);

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?debug=1` });
await waitFor(`window.DavisTwin && window.__DAVIS_TWIN_DEBUG__ && document.getElementById('panel')`);

let st = await state();
console.log('BOOT', JSON.stringify(st));
if (!st.hidden || !st.closed || st.gate || !st.inert || st.ariaHidden !== 'true' || st.focused) throw new Error('panel is not inert/hidden at boot');

/* Trusted TAB outside fullscreen must remain ordinary page navigation and may
 * never reveal or focus the developer controls. */
await key('Tab', 'Tab');
await new Promise((r) => setTimeout(r, 120));
st = await state();
console.log('TAB-NON-FS', JSON.stringify(st));
if (!st.hidden || !st.closed || st.gate || !st.inert || st.focused) throw new Error('panel opened without fullscreen');

/* Synthetic JavaScript keyboard events are not proof of a physical keyboard. */
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Tab',key:'Tab',bubbles:true,cancelable:true}))`);
st = await state();
console.log('SYNTHETIC-TAB', JSON.stringify(st));
if (!st.closed || st.gate || !st.inert) throw new Error('untrusted keyboard event opened developer panel');

/* Enter actual browser fullscreen under a CDP user gesture. */
const entered = await evaluate(`document.documentElement.requestFullscreen().then(()=>true).catch(e=>({error:e.name+':'+e.message}))`, { userGesture:true });
if (entered !== true) throw new Error('requestFullscreen failed: ' + JSON.stringify(entered));
await waitFor(`!!document.fullscreenElement`);
st = await state();
console.log('FULLSCREEN', JSON.stringify(st));
if (!st.fullscreen || !st.closed || !st.inert) throw new Error('fullscreen entry changed the closed panel state');

/* First trusted TAB is the explicit reveal gesture. */
await key('Tab', 'Tab');
await new Promise((r) => setTimeout(r, 120));
st = await state();
console.log('TAB-OPEN', JSON.stringify(st));
if (st.hidden || st.closed || !st.gate || st.inert || st.ariaHidden !== 'false' || !st.focused) throw new Error('trusted fullscreen TAB did not open/focus developer panel');

/* Once inside, TAB is normal accessibility navigation rather than a close
 * toggle. The menu should remain visible and focus should stay within it. */
const firstFocus = st.focusId;
await key('Tab', 'Tab');
await new Promise((r) => setTimeout(r, 80));
st = await state();
console.log('TAB-NAVIGATE', JSON.stringify(st));
if (st.hidden || st.closed || !st.gate || st.inert || !st.focused) throw new Error('TAB navigation closed or escaped developer panel');
if (st.focusId === firstFocus) throw new Error('TAB did not advance focus inside developer panel');

/* Escape closes the developer menu. */
await key('Escape', 'Escape');
await new Promise((r) => setTimeout(r, 120));
st = await state();
console.log('ESC-CLOSE', JSON.stringify(st));
if (!st.hidden || !st.closed || st.gate || !st.inert || st.focused) throw new Error('Escape did not close/inert developer panel');

/* Re-open if the browser also used Escape to leave fullscreen, then verify a
 * real fullscreen exit closes the panel synchronously. */
if (!(await evaluate(`!!document.fullscreenElement`))) {
  const reentered = await evaluate(`document.documentElement.requestFullscreen().then(()=>true).catch(e=>false)`, { userGesture:true });
  if (!reentered) throw new Error('could not re-enter fullscreen after Escape');
  await waitFor(`!!document.fullscreenElement`);
}
await key('Tab','Tab'); await new Promise((r)=>setTimeout(r,80));
st=await state();
if(st.closed||st.inert) throw new Error('could not reopen developer panel before exit test');
await evaluate(`document.exitFullscreen().then(()=>true)`, { userGesture:true });
await waitFor(`!document.fullscreenElement`);
await new Promise((r)=>setTimeout(r,80));
st=await state();
console.log('FULLSCREEN-EXIT',JSON.stringify(st));
if(!st.hidden||!st.closed||st.gate||!st.inert||st.focused) throw new Error('fullscreen exit left developer panel reachable');

if (errors.length) { console.log('PAGE ERRORS', JSON.stringify(errors.slice(0, 5))); process.exitCode = 1; }
ws.close(); browser.kill('SIGKILL'); server.close();
console.log(process.exitCode ? 'DEV PANEL FAIL' : 'DEV PANEL PASS');
