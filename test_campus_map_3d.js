import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const PORT = 8951;
const DEBUG_PORT = 9251;
const CHROME = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].find((candidate) => {
  try { execFileSync('which', [candidate], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) throw new Error('Chromium is required');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const file = path.resolve(path.join(ROOT, requestPath));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(PORT, resolve));

const profile = `/tmp/school-center-map-${Date.now()}`;
const browser = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((item) => item.type === 'page'); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!target) throw new Error('CDP page was not created');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let messageId = 0;
const pending = new Map();
const browserErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message);
  if (message.method === 'Runtime.consoleAPICalled') console.log('BROWSER', (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++messageId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
for (let i = 0; i < 60; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if ((await evaluate(`document.querySelector('#app')?.innerHTML.length || 0`)) > 100) break;
}
await evaluate(`document.querySelector('[data-nav="today"]')?.click()`);
for (let i = 0; i < 40; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (await evaluate(`!!document.querySelector('.cm3d-canvas')`)) break;
}
await new Promise((resolve) => setTimeout(resolve, 2500));

const overview = await evaluate(`({
  card: !!document.querySelector('#campus-map-card'),
  canvas: !!document.querySelector('.cm3d-canvas'),
  info: document.querySelector('.cm3d-info-title')?.textContent || '',
  hud: document.querySelectorAll('.cm3d-hud button').length,
  width: document.querySelector('.cm3d-canvas')?.width || 0
})`);
if (!overview.canvas) throw new Error(`3D canvas did not initialize: ${JSON.stringify(overview)}`);

const focus = await evaluate(`(async () => {
  const button = document.querySelector('[data-show-location]');
  if (button) button.click();
  else document.querySelector('.cm3d-canvas').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 540, clientY: 420, pointerId: 7 }));
  await new Promise((resolve) => setTimeout(resolve, 1400));
  return {
    title: document.querySelector('.cm3d-info-title')?.textContent || '',
    route: document.querySelector('.cm3d-info-route')?.textContent || '',
    focused: (document.querySelector('.cm3d-info-kicker')?.textContent || '').includes('FOCUSED')
  };
})()`);
if (!focus.focused) throw new Error(`Building focus did not activate: ${JSON.stringify(focus)}`);

const pathToggle = await evaluate(`(() => {
  const button = document.querySelector('.cm3d-path-toggle');
  const before = button && !button.classList.contains('is-off');
  button?.click();
  return { before, after: !!button?.classList.contains('is-off') };
})()`);
if (!pathToggle.before || !pathToggle.after) throw new Error(`Wayfinding toggle failed: ${JSON.stringify(pathToggle)}`);

const reset = await evaluate(`(async () => {
  document.querySelector('.cm3d-reset')?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    title: document.querySelector('.cm3d-info-title')?.textContent || '',
    overview: (document.querySelector('.cm3d-info-kicker')?.textContent || '') === 'CAMPUS MAP'
  };
})()`);
if (!reset.overview) throw new Error(`Camera reset failed: ${JSON.stringify(reset)}`);

console.log(JSON.stringify({ overview, focus, pathToggle, reset, browserErrors: browserErrors.length }));
if (browserErrors.length) process.exitCode = 1;
browser.kill(); server.close();
