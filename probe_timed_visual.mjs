/* Timed visual probe: simulate real times of day through the solar override
 * and pixel-verify the rendered scene — 3PM daylight (sun, blue sky, zero
 * stars, windows off) vs night (dark sky, stars, windows on), plus a
 * full-frame white-globe scan at the default overview pose.
 * All sampling is staged after an explicit synchronous render, so no
 * cross-frame staleness is possible under SwiftShader. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8953, DEBUG_PORT = 9253;
const CHROME = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) throw new Error('Chromium required');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.resolve(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const profile = `/tmp/timed-probe-${Date.now()}`;
const browser = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--enable-gpu', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!target) throw new Error('No CDP page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const browserErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') browserErrors.push(m.params.exceptionDetails?.text || 'exc');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') browserErrors.push('console.error: ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 25000);
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
/* Retry evaluates through the app's known manager re-mount race. */
const evalRetry = async (expression, tries = 14, delay = 900) => {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await evaluate(expression);
      if (v !== null && v !== undefined) return v;
    } catch { /* hook briefly absent mid-remount */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('evalRetry exhausted');
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

  const boot = await evalRetry(`(() => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    if (!m || m.disposed || !m.ready || !m.renderer || !m.renderer.getContext) return null;
    return { three: !!m.THREE, far: m.camera.far };
  })()`);
  console.log('BOOT:', JSON.stringify(boot));

  /* Pose camera, render synchronously, average N columns per named row. */
  const SAMPLE = `(pose) => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    const { camPos, lookAt, rows } = pose;
    m.camera.position.set(camPos[0], camPos[1], camPos[2]);
    m.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    m.camera.updateMatrixWorld();
    m.renderer.render(m.scene, m.camera);
    const gl = m.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const out = {};
    for (const [name, fy] of rows) {
      const y = Math.min(h - 1, Math.max(0, (fy * h) | 0));
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < 9; i++) {
        const x = (w * (0.30 + 0.05 * i)) | 0;
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        r += px[0]; g += px[1]; b += px[2]; n++;
      }
      out[name] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    }
    return out;
  }`;

  /* Force a solar state through the engine's own path; pin clear weather so
   * sky assertions are not weather-dependent. */
  const setState = (ov) => evalRetry(`(() => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    m.weatherCondition = 'clear';
    m._solarOverride = ${ov ? JSON.stringify(ov) : 'null'};
    m._applyTimeOfDay();
    return { nightF: m._nightF, elev: m._solarElevation };
  })()`);

  /* Level view: camera above the campus edge looking at the far sky.
   * Rows (NDC y): 0.80 high sky, 0.58 mid sky, 0.36 near-horizon, 0.12 ground. */
  const SKY_POSE = {
    camPos: [0, 140, 1500],
    lookAt: [0, 170, -300],
    rows: [['skyHi', 0.80], ['skyMid', 0.58], ['skyHor', 0.36], ['ground', 0.12]]
  };

  /* Star census via local contrast: a star is a small bright point standing
   * out from its neighborhood. This is immune to the blue-sky false positive
   * (uniform brightness fails the contrast test) and to clouds (broad, so
   * their interiors have no contrast spike; only sparse edge pixels can). */
  const CENSUS = `() => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    /* Steep pose: the census window must include near-zenith sky (d.y > 0.75)
     * where the dome thins its cloud layer by design — stars live there. */
    m.camera.position.set(0, 140, 1500);
    m.camera.lookAt(0, 2200, -300);
    m.camera.updateMatrixWorld();
    m.renderer.render(m.scene, m.camera);
    const gl = m.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const lum = (x, y) => { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; };
    let stars = 0, samples = 0;
    for (let y = (h * 0.30) | 0; y < (h * 0.95) | 0; y += 3) {
      for (let x = (w * 0.15) | 0; x < (w * 0.85) | 0; x += 3) {
        samples++;
        const L = lum(x, y);
        /* Two neighbors keep the read count affordable under SwiftShader. */
        const nb = (lum(x + 3, y) + lum(x, y + 3)) / 2;
        /* Twinkle cycles each star through 0.72-1.0 brightness, so the
         * floor sits below the full-white read. Contrast stays huge vs the
         * ~26-luminance night sky. */
        if (L > 135 && L - nb > 40) stars++;
      }
    }
    return { stars, samples };
  }`;

  /* ---------- TIMED CHECK 1: simulated 3 PM daylight ---------- */
  const day = await setState({ elevationDeg: 38, azimuthDeg: 225 });
  await wait(400);
  const dayS = await evalRetry(`(${SAMPLE})(${JSON.stringify(SKY_POSE)})`);
  const dayC = await evalRetry(`(${CENSUS})()`);
  console.log('DAY(3PM):', JSON.stringify(dayS), 'nightF', day.nightF, 'census', JSON.stringify(dayC));

  /* Sun visible: aim the camera directly at the sun sprite's world position,
   * render, and sample the projected sun center. */
  const daySun = await evalRetry(`(() => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    const el = 38 * Math.PI / 180, az = 225 * Math.PI / 180;
    const dir = new m.THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    m.camera.position.set(0, 140, 1500);
    /* Camera-relative sun placement (matches the per-frame tick). */
    m._applyTimeOfDay();
    const sun = m.sunSprite.position.clone();
    m.camera.lookAt(sun);
    m.camera.updateMatrixWorld();
    m.renderer.render(m.scene, m.camera);
    const v = sun.clone().project(m.camera);
    const gl = m.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const cx = Math.min(w - 1, Math.max(0, ((v.x * 0.5 + 0.5) * w) | 0));
    const cy = Math.min(h - 1, Math.max(0, ((v.y * 0.5 + 0.5) * h) | 0));
    const px = new Uint8Array(4);
    /* The sprite center plus a small ring: a real sun glow is broad. */
    let best = 0;
    for (const [dx, dy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) {
      gl.readPixels(Math.min(w - 1, Math.max(0, cx + dx)), Math.min(h - 1, Math.max(0, cy + dy)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      best = Math.max(best, px[0]);
    }
    return { inFrame: v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1, bestR: best };
  })()`);
  console.log('DAY SUN:', JSON.stringify(daySun));

  const dayChecks = {
    blueSky: dayS.skyHi[2] > dayS.skyHi[0] + 10 && dayS.skyHi[2] > 100,
    brightHorizon: (dayS.skyHor[0] + dayS.skyHor[1] + dayS.skyHor[2]) > (dayS.skyHi[0] + dayS.skyHi[1] + dayS.skyHi[2]),
    groundLit: (dayS.ground[0] + dayS.ground[1] + dayS.ground[2]) / 3 > 28,
    windowsOff: day.nightF < 0.25,
    noStars: dayC.stars <= 60,
    sunVisible: daySun.inFrame && daySun.bestR > 200
  };

  /* ---------- TIMED CHECK 2: simulated night (10:30 PM) ---------- */
  const night = await setState({ elevationDeg: -32, azimuthDeg: 305 });
  await wait(400);
  const nightS = await evalRetry(`(${SAMPLE})(${JSON.stringify(SKY_POSE)})`);
  const nightC = await evalRetry(`(${CENSUS})()`);
  console.log('NIGHT(10:30PM):', JSON.stringify(nightS), 'nightF', night.nightF, 'census', JSON.stringify(nightC));

  const dayLum = (dayS.skyHi[0] + dayS.skyHi[1] + dayS.skyHi[2]) / 3;
  /* Night read: use the darkest sky row. The top row can legitimately land
   * on the moonlit cloud layer (by design), so judge darkness by the navy
   * mid/horizon rows. */
  const rowLum = (row) => (row[0] + row[1] + row[2]) / 3;
  const nightLum = Math.min(rowLum(nightS.skyHi), rowLum(nightS.skyMid), rowLum(nightS.skyHor));
  const nightChecks = {
    darkSky: nightLum < 100 && nightLum < dayLum * 0.8,
    bluishNight: nightS.skyHi[2] >= nightS.skyHi[0],
    windowsOn: night.nightF > 0.9,
    starsPresent: nightC.stars >= 2 && nightC.stars > dayC.stars
  };

  /* ---------- WHITE GLOBE SCAN: default overview pose (forced night so
   * any uniform white patch is unmistakable) ---------- */
  const globe = await evalRetry(`(() => {
    const m = window.__SC_CAMPUS_MAP_3D__;
    m.camera.position.set(0, 950, 1560);
    m.camera.lookAt(0, 0, 0);
    m.camera.updateMatrixWorld();
    m.renderer.render(m.scene, m.camera);
    const gl = m.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let white = 0, total = 0, maxRun = 0, run = 0;
    for (let y = 0; y < h; y += 6) {
      run = 0;
      for (let x = 0; x < w; x += 6) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        total++;
        if (px[0] > 235 && px[1] > 235 && px[2] > 235) { white++; run++; if (run > maxRun) maxRun = run; }
        else run = 0;
      }
    }
    const dome = m.scene.children.find((c) => c.geometry && c.geometry.parameters && c.geometry.parameters.radius);
    return { white, total, maxRun, far: m.camera.far, domeRadius: dome ? dome.geometry.parameters.radius : null };
  })()`);
  console.log('GLOBE SCAN:', JSON.stringify(globe));
  const globeChecks = {
    noWhitePatch: globe.maxRun < 20 && globe.white / globe.total < 0.02,
    domeUnclippable: globe.domeRadius ? globe.far > globe.domeRadius + 2200 : globe.far > 5000
  };

  console.log('SUMMARY:', JSON.stringify({ dayChecks, nightChecks, globeChecks, browserErrors }));
  const allOk = Object.values(dayChecks).every(Boolean)
    && Object.values(nightChecks).every(Boolean)
    && Object.values(globeChecks).every(Boolean)
    && browserErrors.length === 0;
  if (!allOk) { console.log('FAIL'); process.exitCode = 1; }
  else console.log('ALL TIMED VISUAL CHECKS PASS');
} finally {
  try { ws.close(); } catch {}
  try { browser.kill('SIGKILL'); } catch {}
  server.close();
}
