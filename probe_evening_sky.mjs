/* Evening sky-cycle probe: force real solar elevations through the evening
 * (13:00 midday ~40deg, 18:30 golden ~6.7deg, 19:40 sunset ~1deg, 20:20
 * twilight ~-4deg, 21:30 night ~-15deg) and pixel-verify the sky dims
 * monotonically, warms at sunset, and overcast evenings dim with the sun. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8970, DEBUG_PORT = 9270;
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
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/evening-${Date.now()}`, '--window-size=1280,900', 'about:blank'
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

/* Set weather + solar override, render from a level-view pose, sample sky. */
const sampleSky = (condition, elevationDeg, azimuthDeg) => evalRetry(`(() => {
  const m = window.__SC_CAMPUS_MAP_3D__;
  m.weatherCondition = '${condition}';
  m._solarOverride = { elevationDeg: ${elevationDeg}, azimuthDeg: ${azimuthDeg} };
  m._applyTimeOfDay();
  m._applyWeatherEnvironment();
  m.camera.position.set(0, 140, 1500);
  m.camera.lookAt(0, 170, -300);
  m.camera.updateMatrixWorld();
  m.renderer.render(m.scene, m.camera);
  const gl = m.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const at = (fy) => { gl.readPixels((w * 0.5) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; };
  const rgbAt = (fy) => { gl.readPixels((w * 0.5) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]]; };
  const hi = rgbAt(0.80), mid = rgbAt(0.58), hor = rgbAt(0.36);
  return { dayF: +m.skyUniforms.uDayF.value.toFixed(3),
    lumHi: Math.round(at(0.80)), lumMid: Math.round(at(0.58)),
    hi, hor, overcast: m.skyUniforms.uOvercast.value };
})()`);

const times = [
  ['13:00 midday', 40, 200],
  ['18:30 golden', 6.7, 250],
  ['19:40 sunset', 1.0, 262],
  ['20:20 twilight', -4, 275],
  ['21:30 night', -15, 300]
];
const clear = [], overcast = [];
for (const [label, el, az] of times) {
  const c = await sampleSky('clear', el, az);
  clear.push({ label, ...c });
  const o = await sampleSky('overcast', el, az);
  overcast.push({ label, ...o });
  console.log(`${label}  clear: dayF=${c.dayF} lum=${c.lumHi}/${c.lumMid} rgb=${JSON.stringify(c.hi)}   overcast: dayF=${o.dayF} lum=${o.lumMid} rgb=${JSON.stringify(o.hor)}`);
}
const lums = clear.map((s) => Math.min(s.lumHi, s.lumMid));
const checks = {
  /* Midday is the brightest state. */
  middayBright: clear[0].lumHi > 140,
  /* Monotonic evening dimming from golden hour through night. */
  monotonic: lums[1] > lums[2] && lums[2] >= lums[3] && lums[3] > lums[4],
  /* 18:30 is VISIBLY darker than midday (the user's complaint). */
  eveningDims: lums[1] < clear[0].lumHi - 25,
  /* Sunset warmth: red channel leads blue near the horizon at 19:40. */
  sunsetWarm: clear[2].hor[0] > clear[2].hor[2] * 0.85 || clear[1].hor[0] > clear[1].hor[2] * 0.8,
  /* Night is dark. */
  nightDark: lums[4] < 70,
  /* Overcast evening dims with the sun (wash now sun-height aware). */
  overcastDims: (() => {
    const day = overcast[0].lumMid, evening = overcast[1].lumMid, night = overcast[4].lumMid;
    return evening < day - 25 && night < day - 60;
  })()
};
console.log('CHECKS:', JSON.stringify(checks));
ws.close();
browser.kill('SIGKILL');
server.close();
const ok = Object.values(checks).every(Boolean);
console.log(ok ? 'EVENING CYCLE PASS' : 'FAIL');
process.exitCode = ok ? 0 : 1;
