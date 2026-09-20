/* Reproduce the "errant white globe" at the default reset view: scan the
 * frame for oversized bright-white blobs across clear-day, overcast-day and
 * night states; report blob pixel radius + location + sun sprite state. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8972, DEBUG_PORT = 9272;
const CHROME = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) throw new Error('Chromium required');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.resolve(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const browser = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--enable-gpu', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/globe-${Date.now()}`, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')); } }, 25000);
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const evalRetry = async (expression, tries = 14) => {
  for (let i = 0; i < tries; i++) {
    try { const v = await evaluate(expression); if (v !== null && v !== undefined) return v; } catch {}
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('evalRetry exhausted');
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await evalRetry(`(() => { const m = window.__SC_CAMPUS_MAP_3D__; return m && m.ready && !m.disposed ? true : null; })()`);

const scan = (label, condition, elevationDeg, azimuthDeg) => evalRetry(`(() => {
  const m = window.__SC_CAMPUS_MAP_3D__;
  m.weatherCondition = '${condition}';
  m._solarOverride = ${elevationDeg === null ? 'null' : `{ elevationDeg: ${elevationDeg}, azimuthDeg: ${azimuthDeg} }`};
  m._applyTimeOfDay();
  /* The exact reset/overview pose. */
  m.camera.position.set(0, 950, 1560);
  m.camera.lookAt(0, 0, 0);
  m.camera.updateMatrixWorld();
  m.renderer.render(m.scene, m.camera);
  const gl = m.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  /* Blob detection: brightest near-white pixel found on a coarse grid. */
  let bx = -1, by = -1, bl = 0;
  for (let y = 2; y < h; y += 6) {
    for (let x = 2; x < w; x += 6) {
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const mn = Math.min(px[0], px[1], px[2]);
      const l = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
      if (mn > 185 && l > bl) { bl = l; bx = x; by = y; }
    }
  }
  let radius = 0;
  if (bx >= 0) {
    /* Flood right/left/down/up along near-white to size the blob. */
    const isW = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return Math.min(px[0], px[1], px[2]) > 175;
    };
    let x0 = bx, x1 = bx, y0 = by, y1 = by;
    while (isW(x0 - 1, by)) x0--;
    while (isW(x1 + 1, by)) x1++;
    while (isW(bx, y0 - 1)) y0--;
    while (isW(bx, y1 + 1)) y1++;
    radius = Math.max(x1 - x0, y1 - y0) / 2;
    /* Solidity: a solid disc fills ~78% of its bbox; a thin grid line the
     * flood walked along fills a few percent. Only solid blobs are globes. */
    let fill = 0, n2 = 0;
    for (let yy = y0; yy <= y1; yy += 2) for (let xx = x0; xx <= x1; xx += 2) { n2++; if (isW(xx, yy)) fill++; }
    var solidity = n2 ? fill / n2 : 0;
    if (solidity < 0.4) radius = 0; /* thin line artifact, not a globe */
  }
  const cloudInfo = m.clouds?.length ? { n: m.clouds.length, matOpacity: +m.cloudMat.opacity.toFixed(2),
    ys: m.clouds.map((c) => Math.round(c.position.y)).slice(0, 4) } : null;
  const sun = m.sunSprite;
  const v = sun.position.clone().project(m.camera);
  return { label: '${label}', blobRadiusPx: Math.round(radius), solidity: +(solidity ?? 0).toFixed(2), blobAt: bx >= 0 ? [bx, by] : null,
    cloudInfo,
    blobLum: Math.round(bl),
    sunScreenPx: (v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1)
      ? [Math.round((v.x * 0.5 + 0.5) * w), Math.round((v.y * 0.5 + 0.5) * h)] : null,
    sunOpacity: +sun.material.opacity.toFixed(2), sunScale: Math.round(sun.scale.x),
    sunWorldDist: Math.round(sun.position.distanceTo(m.camera.position)) };
})()`);

const results = [];
for (const [label, cond, el, az] of [
  ['live-overcast-day', 'overcast', 25, 250],
  ['clear-day', 'clear', 35, 200],
  ['night', 'clear', -25, 300]
]) {
  const r = await scan(label, cond, el, az);
  results.push(r);
  console.log(JSON.stringify(r));
}
/* Visual confirmation: ASCII render of the reset view, clear day. */
await evaluate(`(() => {
  const m = window.__SC_CAMPUS_MAP_3D__;
  m.weatherCondition = 'clear';
  m._solarOverride = { elevationDeg: 35, azimuthDeg: 200 };
  m._applyTimeOfDay();
  m.camera.position.set(0, 950, 1560);
  m.camera.lookAt(0, 0, 0);
  m.camera.updateMatrixWorld();
  m.renderer.render(m.scene, m.camera);
  return true;
})()`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/reset_view.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot saved /tmp/reset_view.png');
ws.close();
browser.kill('SIGKILL');
server.close();
const globes = results.filter((r) => r.blobRadiusPx > 40);
console.log(globes.length ? `GLOBE REPRODUCED in ${globes.map((g) => g.label).join(', ')}` : 'no oversized white blob at reset view');
process.exitCode = 0;
