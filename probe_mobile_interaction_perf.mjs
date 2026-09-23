/* Mobile interaction performance probe (orbit / pan / pinch at the main
 * intersection). Boots the twin in the mobile profile (quality=medium, 2x DPR,
 * 900x640), drives scripted touch gestures through CDP's real touch pipeline,
 * and reports per-phase frame-time statistics, draw calls, shadow/env build
 * counts and a sampled CPU profile of the main thread during gestures.
 * If qa-artifacts/mobile-perf-baseline.json exists the numbers are printed
 * next to it as a before/after table; pass --save to write a new baseline. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8976, DEBUG_PORT = 9276;
const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) throw new Error('Chromium required');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  '--disable-background-networking', '--disable-component-update', '--disable-crash-reporter',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=/tmp/mobile-perf-${Date.now()}`,
  '--window-size=900,640', 'about:blank'
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 480 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) throw new Error('no CDP page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args?.map((a) => a.value).join(' ') || 'console error');
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const evalRetry = async (expression, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try { const v = await evaluate(expression); if (v !== null && v !== undefined) return v; } catch {}
    await new Promise((r) => setTimeout(r, 900));
  }
  throw new Error('evalRetry exhausted');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable'); await send('Page.enable');
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 250 });
/* Emulate a mid-range phone so the twin takes its mobile profile: coarse
 * pointer, touch, 2x DPR, 900x640 CSS (same shape the acceptance suite uses).
 * quality=medium is the tier a typical 6-8 core phone picks. */
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 640, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?debug=1&quality=medium` });
await evalRetry(`(() => { const d = window.__DAVIS_TWIN_DEBUG__; return d && d.mobileProfile === true && d.tierName === 'medium' ? d.tierName : null; })()`);

/* ---- in-page frame recorder ---------------------------------------------- */
await evaluate(`(() => {
  const d = window.__DAVIS_TWIN_DEBUG__;
  window.__PERF__ = {
    deltas: [], last: performance.now(), recording: false,
    start() { this.deltas.length = 0; this.last = performance.now(); this.recording = true;
      const loop = (t) => { if (!this.recording) return; this.deltas.push(t - this.last); this.last = t; requestAnimationFrame(loop); };
      requestAnimationFrame(loop); },
    stop() { this.recording = false; return this.stats(); },
    stats() {
      const a = this.deltas.slice(2).sort((x, y) => x - y);
      const q = (p) => a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]) : 0;
      const sum = a.reduce((s, v) => s + v, 0);
      const inf = window.__DAVIS_TWIN_DEBUG__.renderer.info.render;
      return { frames: a.length, fps: a.length ? Math.round(a.length / (sum / 1000)) : 0,
        p50: q(0.5), p95: q(0.95), max: a.length ? Math.round(a[a.length - 1]) : 0,
        drops50: a.filter((v) => v > 50).length, drops100: a.filter((v) => v > 100).length,
        calls: inf.calls, tris: inf.triangles };
    }
  };
  return true;
})()`);

/* ---- move the camera to the intersection hotspot ------------------------- */
const setup = await evaluate(`(() => {
  const d = window.__DAVIS_TWIN_DEBUG__;
  d.controls.target.set(-207, 0, -266);
  d.camera.position.set(-117, 95, -146);
  d.camera.lookAt(d.controls.target);
  d.controls.update();
  d.interaction.lastInput = performance.now();
  return { target: d.controls.target.toArray().map(v => Math.round(v)), mobile: d.mobileProfile, tier: d.tierName, pr: d.renderer.getPixelRatio(), fb: [d.renderer.domElement.width, d.renderer.domElement.height] };
})()`);
console.log('SETUP', JSON.stringify(setup));
await sleep(1500);

/* ---- gesture engine: CDP touch events, timed moves ----------------------- */
const touch = async (points, type) => {
  await send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 }))
  });
};
const centerX = 450, centerY = 320;
const gestures = {
  async orbit(ms) {
    const id = 21;
    await touch([{ id, x: centerX, y: centerY }], 'touchStart');
    const t0 = Date.now(); let a = 0;
    while (Date.now() - t0 < ms) {
      a += 0.22;
      await touch([{ id, x: centerX + Math.sin(a) * 170, y: centerY + Math.cos(a) * 55 }], 'touchMove');
      await sleep(150);
    }
    await touch([{ id, x: centerX, y: centerY }], 'touchEnd');
    return { azStart: null };
  },
  async pan(ms) {
    const idA = 31, idB = 32;
    await touch([{ id: idA, x: centerX - 30, y: centerY }, { id: idB, x: centerX + 30, y: centerY }], 'touchStart');
    await sleep(80);
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < ms) {
      i++;
      await touch([{ id: idA, x: centerX - 30 + i * 4, y: centerY + i * 1.5 }, { id: idB, x: centerX + 30 + i * 4, y: centerY + i * 1.5 }], 'touchMove');
      await sleep(140);
    }
    await touch([{ id: idA, x: centerX, y: centerY }], 'touchEnd');
    await touch([{ id: idB, x: centerX, y: centerY }], 'touchEnd');
  },
  async pinch(ms) {
    const idA = 41, idB = 42;
    await touch([{ id: idA, x: centerX - 40, y: centerY }, { id: idB, x: centerX + 40, y: centerY }], 'touchStart');
    await sleep(80);
    const t0 = Date.now(); let k = 0;
    while (Date.now() - t0 < ms) {
      k = Math.sin(((Date.now() - t0) / ms) * Math.PI * 2) * 110;
      await touch([{ id: idA, x: centerX - 40 - k, y: centerY }, { id: idB, x: centerX + 40 + k, y: centerY }], 'touchMove');
      await sleep(140);
    }
    await touch([{ id: idA, x: centerX, y: centerY }], 'touchEnd');
    await touch([{ id: idB, x: centerX, y: centerY }], 'touchEnd');
  }
};

const cameraState = () => evaluate(`(() => { const d = window.__DAVIS_TWIN_DEBUG__;
  return { az: +d.controls.getAzimuthalAngle().toFixed(4), dist: +d.camera.position.distanceTo(d.controls.target).toFixed(1), tx: +d.controls.target.x.toFixed(1), tz: +d.controls.target.z.toFixed(1) }; })()`);
const lightInventory = () => evaluate(`(() => { const d = window.__DAVIS_TWIN_DEBUG__;
  let lights = 0, litLights = 0; d.scene.traverse(o => { if (o.isLight) { lights++; if (o.visible && o.intensity > 0) litLights++; } });
  return { lights, litLights, programs: d.renderer.info.programs.length, night: +d.ST.night.toFixed(3) }; })()`);

/* Flip the clock via the same #timeRange input the acceptance suite uses
 * (value 0 = midnight local, 720 = noon local). The next updateEnv() applies
 * the solar state. Programs/lights are counted per phase so shader-compile
 * churn (a growing program cache mid-gesture) shows up directly. */
const setNight = async (night) => {
  await evaluate(`(() => { const e = document.querySelector('#timeRange'); e.value = ${night ? "'0'" : "'720'"}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  for (let i = 0; i < 50; i++) {
    const inv = await lightInventory();
    if (night ? inv.night > .85 : inv.night < .15) return inv;
    await sleep(400);
  }
  throw new Error('time-of-day switch did not settle; night=' + (await lightInventory()).night);
};

const phases = [
  ['idle', 2000, null],
  ['orbit', 3600, 'orbit'],
  ['pan', 3600, 'pan'],
  ['pinch', 3600, 'pinch'],
  ['idle2', 2000, null]
];
const results = {};
const runPhase = async (name, ms, gesture, tag) => {
  const before = await evaluate(`(() => { const d = window.__DAVIS_TWIN_DEBUG__; return { shadows: d.shadowTrack.builds, env: d.PERF ? d.PERF.envBuilds : -1, parkedVisible: d.viewPerf.visibleParked }; })()`);
  const inv0 = await lightInventory();
  const cam0 = await cameraState();
  await evaluate(`window.__PERF__.start()`);
  await send('Profiler.start');
  if (gesture) await gestures[gesture](ms);
  else await sleep(ms);
  const profile = gesture ? (await send('Profiler.stop')).result.profile : null;
  const stats = await evaluate(`window.__PERF__.stop()`);
  const after = await evaluate(`(() => { const d = window.__DAVIS_TWIN_DEBUG__; return { shadows: d.shadowTrack.builds, env: d.PERF ? d.PERF.envBuilds : -1 }; })()`);
  const inv1 = await lightInventory();
  const cam1 = await cameraState();
  results[tag] = {
    ...stats,
    shadowBuilds: after.shadows - before.shadows,
    envBuilds: (before.env >= 0 && after.env >= 0) ? after.env - before.env : -1,
    parkedVisible: before.parkedVisible,
    programsDelta: inv1.programs - inv0.programs,
    litLights: inv1.litLights,
    moved: { az: +Math.abs(cam1.az - cam0.az).toFixed(3), dist: +Math.abs(cam1.dist - cam0.dist).toFixed(1), pan: +Math.hypot(cam1.tx - cam0.tx, cam1.tz - cam0.tz).toFixed(1) }
  };
  console.log(`PHASE ${tag.padEnd(10)} ${JSON.stringify(results[tag])}`);
  if (profile) {
    const flat = await evaluate(`((nodes, samples, interval) => {
      const byId = new Map(nodes.map(n => [n.id, n]));
      const self = new Map();
      for (const id of samples) { const n = byId.get(id); if (!n || !n.callFrame) continue;
        const key = (n.callFrame.functionName || '(anon)') + ' @' + String(n.callFrame.url).split('/').pop() + ':' + n.callFrame.lineNumber;
        self.set(key, (self.get(key) || 0) + 1); }
      return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, hits]) => ({ fn: k, ms: Math.round(hits * interval / 1000) }));
    })(${JSON.stringify(profile.nodes)}, ${JSON.stringify(profile.samples)}, ${profile.endTime && profile.startTime ? (profile.endTime - profile.startTime) / (profile.samples?.length || 1) : 250})`);
    console.log('CPU TOP', JSON.stringify(flat));
  }
};
for (const [name, ms, gesture] of phases) await runPhase(name, ms, gesture, name);

/* ---- night pass: same gestures at midnight ------------------------------ */
await setNight(true);
const nightPhases = [
  ['night-idle', 2000, null],
  ['night-orbit', 2800, 'orbit'],
  ['night-pan', 2800, 'pan'],
  ['night-pinch', 2800, 'pinch']
];
for (const [name, ms, gesture] of nightPhases) await runPhase(name, ms, gesture, name);
await setNight(false);

const gestures3 = ['orbit', 'pan', 'pinch'];
const worstMax = Math.max(...gestures3.map((g) => results[g].max));
const worstDrops = gestures3.reduce((s, g) => s + results[g].drops100 + results[g].drops50, 0);
const movedOk = gestures3.every((g) => { const m = results[g].moved; return g === 'orbit' ? m.az > 0.05 : g === 'pan' ? m.pan > 5 : m.dist > 5; });
const nightWorstMax = Math.max(...['night-orbit', 'night-pan', 'night-pinch'].map((g) => results[g].max));
const nightWorstDrops = ['night-orbit', 'night-pan', 'night-pinch'].reduce((s, g) => s + results[g].drops100 + results[g].drops50, 0);
console.log('GESTURE WORST max=' + worstMax + 'ms drops=' + worstDrops + ' movedOk=' + movedOk);
console.log('NIGHT WORST max=' + nightWorstMax + 'ms drops=' + nightWorstDrops + ' programsDelta=' + ['night-orbit', 'night-pan', 'night-pinch'].map((g) => results[g].programsDelta).join(','));

const gestureTags=['orbit','pan','pinch','night-orbit','night-pan','night-pinch'];
const noGestureShadowRebuilds=gestureTags.every(g=>results[g].shadowBuilds===0);
const noGestureEnvRebuilds=gestureTags.every(g=>results[g].envBuilds===0);
const noNightProgramChurn=['night-orbit','night-pan','night-pinch'].every(g=>results[g].programsDelta===0);
console.log('PERF INVARIANTS',JSON.stringify({movedOk,noGestureShadowRebuilds,noGestureEnvRebuilds,noNightProgramChurn}));
if(!movedOk||!noGestureShadowRebuilds||!noGestureEnvRebuilds||!noNightProgramChurn){
  console.log('PERF INVARIANT FAILURE',JSON.stringify({movedOk,noGestureShadowRebuilds,noGestureEnvRebuilds,noNightProgramChurn}));
  process.exitCode=1;
}

const summary = { setup, phases: results, errors: pageErrors.slice(0, 5), worstMax, worstDrops, movedOk, nightWorstMax, nightWorstDrops, noGestureShadowRebuilds, noGestureEnvRebuilds, noNightProgramChurn };
const baselinePath = path.join(ROOT, 'qa-artifacts', 'mobile-perf-baseline.json');
if (process.argv.includes('--save')) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(summary, null, 1));
  console.log('BASELINE SAVED', baselinePath);
} else if (fs.existsSync(baselinePath)) {
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  console.log('\nBEFORE -> AFTER (gestures)');
  console.log('phase    fps          p50         p95          max          drops        calls');
  for (const g of gestures3) {
    const b = base.phases[g], a = results[g];
    console.log(
      g.padEnd(8),
      `${b.fps}->${a.fps}`.padEnd(12),
      `${b.p50}->${a.p50}`.padEnd(11),
      `${b.p95}->${a.p95}`.padEnd(12),
      `${b.max}->${a.max}`.padEnd(12),
      `${b.drops50 + b.drops100}->${a.drops50 + a.drops100}`.padEnd(12),
      `${b.calls}->${a.calls}`
    );
  }
  const improved = gestures3.every((g) => {
    const b = base.phases[g], a = results[g];
    return a.max <= b.max * 0.85 && (a.drops50 + a.drops100) <= (b.drops50 + b.drops100) * 0.6;
  });
  console.log('IMPROVED:', improved);
}

if (pageErrors.length) { console.log('PAGE ERRORS', JSON.stringify(pageErrors.slice(0, 5))); process.exitCode = 1; }
ws.close(); browser.kill('SIGKILL'); server.close();
console.log(process.exitCode ? 'MOBILE PERF FAIL' : 'MOBILE PERF DONE');
