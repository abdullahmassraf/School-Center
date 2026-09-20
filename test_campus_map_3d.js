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
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  /* SwiftShader software WebGL: do not use --disable-gpu, which prevents the
   * WebGL context required by Three.js from being created. */
  '--enable-gpu', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
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
let hit = null;
let messageId = 0;
const pending = new Map();
const browserErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = (message.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    browserErrors.push(`console.error: ${text.slice(0, 300)}`);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 20000);
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result?.result?.value;
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await evaluate(`document.querySelector('#app')?.innerHTML.length || 0`)) > 100) break;
  }
  await evaluate(`document.querySelector('[data-nav="today"]')?.click()`);
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await evaluate(`!!document.querySelector('.cm3d-canvas')`)) break;
  }
  /* Wait for full init (THREE module import + building extrusion), not just
   * canvas presence — a fixed sleep races SwiftShader/CDN timing. */
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const ready = await evaluate(`!!window.__SC_CAMPUS_MAP_3D__?.ready && (window.__SC_CAMPUS_MAP_3D__?.meshById?.size || 0) > 0`);
    if (ready) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));

  const overview = await evaluate(`(() => {
    const canvas = document.querySelector('.cm3d-canvas');
    const manager = window.__SC_CAMPUS_MAP_3D__;
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    return {
      card: !!document.querySelector('#campus-map-card'),
      canvas: !!canvas,
      webgl: !!gl,
      hud: document.querySelectorAll('.cm3d-hud button').length,
      infoCard: !!document.querySelector('.cm3d-info'),
      weatherChip: !!document.querySelector('.cm3d-weather'),
      weatherCondition: document.querySelector('.cm3d-weather')?.dataset.condition || document.querySelector('#cm3d-mount')?.dataset.weatherCondition || '',
      weatherTemp: document.querySelector('.cm3d-weather-temp')?.textContent || '',
      cameraMode: manager?.camMode || '',
      pathSegments: Number(document.querySelector('#cm3d-mount')?.dataset.pathSegments || 0),
      pathVisible: document.querySelector('#cm3d-mount')?.dataset.pathVisible !== 'false',
      pathBtnHidden: document.querySelector('.cm3d-path-toggle')?.classList.contains('is-hidden') ?? null
    };
  })()`);
  if (!overview.canvas || !overview.webgl || overview.hud !== 2) throw new Error(`3D overview did not initialize: ${JSON.stringify(overview)}`);
  if (overview.infoCard) throw new Error('Legacy info card still rendered — it must be removed');
  /* The legacy 2D SVG plan must be gone from the DOM entirely. */
  const legacy2d = await evaluate(`(() => ({
    stage: !!document.getElementById('cm-stage-svg'),
    svg: !!document.querySelector('.campus-map-svg'),
    buildings: document.querySelectorAll('.cm-building').length,
    lots: document.querySelectorAll('.cm-lot').length,
    pin: !!document.getElementById('cm-pin'),
    modeToggle: !!document.querySelector('.cm-mode-toggle')
  }))()`);
  if (legacy2d.stage || legacy2d.svg || legacy2d.buildings || legacy2d.lots || legacy2d.pin || legacy2d.modeToggle) {
    throw new Error(`Legacy 2D map elements still present in the DOM: ${JSON.stringify(legacy2d)}`);
  }
  /* Overview shows no route: the bus-stop path belongs to a focused
   * building only, and the toggle button is hidden until one is selected. */
  if (overview.pathSegments) throw new Error(`Route visible at overview — must be empty: ${JSON.stringify(overview)}`);
  if (overview.pathBtnHidden !== true) throw new Error(`Wayfinding toggle visible with no selection: ${JSON.stringify(overview)}`);
  if (!overview.weatherChip) throw new Error(`Weather chip missing from the 3D map: ${JSON.stringify(overview)}`);
  const chipPos = await evaluate(`(() => {
    const chip = document.querySelector('.cm3d-weather');
    const mount = document.querySelector('#cm3d-mount');
    if (!chip || !mount) return null;
    const cs = getComputedStyle(chip);
    const cr = chip.getBoundingClientRect();
    const mr = mount.getBoundingClientRect();
    return { position: cs.position, top: cs.top, left: cs.left, offsetTop: Math.round(cr.top - mr.top), offsetLeft: Math.round(cr.left - mr.left), visible: cr.width > 0 && cr.height > 0 };
  })()`);
  if (!chipPos || chipPos.position !== 'absolute' || !chipPos.visible || chipPos.offsetTop > 30 || chipPos.offsetLeft > 30) {
    throw new Error(`Weather chip is not pinned top-left: ${JSON.stringify(chipPos)}`);
  }
  console.log(`WEATHER: condition=${overview.weatherCondition || 'pending'} chip="${overview.weatherTemp}" pinned top-left (offset ${chipPos.offsetLeft},${chipPos.offsetTop})`);

  /* Derive a real projected building center from the live Three.js scene, then
   * click that coordinate through CDP so the test still exercises the DOM's
   * trusted pointer/raycast path rather than directly calling focus(). */
  /* Retry the projection generously: the app's minute clock can re-render the
   view mid-test, disposing the manager (hook deleted) while its replacement
   boots for ~10s under SwiftShader. Surface eval exceptions too. */
let hit = null;
let hitErr = null;
for (let i = 0; i < 60 && !hit; i++) {
    hit = await evaluate(`(() => {
    const manager = window.__SC_CAMPUS_MAP_3D__;
    const mesh = manager?.meshById?.get('J');
    const canvas = document.querySelector('.cm3d-canvas');
    if (!manager || !mesh || !canvas) return null;
    const box = new manager.THREE.Box3().setFromObject(mesh);
    const point = box.getCenter(new manager.THREE.Vector3()).project(manager.camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * 0.5 * rect.width, y: rect.top + (1 - point.y) * 0.5 * rect.height };
  })()`).catch((e) => { hitErr = e; return null; });
  if (!hit) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!hit && hitErr) console.log(`HIT-EVAL-ERR: ${hitErr.message?.slice(0, 200)}`);
  if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.y)) {
    /* No inspection hook (e.g. the site is served from a non-loopback origin):
     * fall back to the app's public Show location control, which drives the
     * same manager.focus() integration. */
    const viaControl = await evaluate(`(async () => {
      const button = document.querySelector('[data-show-location]');
      if (!button) return null;
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1600));
      return { x: null, y: null, via: button.dataset.showLocation };
    })()`);
    if (!viaControl) throw new Error('Could not calculate a projected building hit point and no Show location control exists');
    hit = viaControl;
  }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const focus = await evaluate(`(() => {
    const mount = document.querySelector('#cm3d-mount');
    return {
      status: document.getElementById('cm-status-text')?.textContent || '',
      cameraMode: mount?.dataset.cameraMode || '',
      focusBuilding: mount?.dataset.focusBuilding || '',
      pathSegments: Number(mount?.dataset.pathSegments || 0)
    };
  })()`);
  if (focus.cameraMode !== 'focus' || focus.focusBuilding !== 'J') throw new Error(`Building selection/camera focus failed: ${JSON.stringify(focus)}`);
  /* Reference look: focused building solid, others translucent glass. */
  const opac = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const out = {};
    for (const [id, m] of mgr.meshById) out[id] = +m.material.opacity.toFixed(2);
    return out;
  })()`);
  if (opac.J < 0.95) throw new Error(`Focused building not solid: ${JSON.stringify(opac)}`);
  for (const id of ['H', 'B', 'C', 'M']) {
    if (opac[id] > 0.35) throw new Error(`Non-focused ${id} not translucent: ${JSON.stringify(opac)}`);
  }
  /* The position bug: focused meshes must never be scaled or moved. */
  const transforms = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const out = {};
    for (const [id, m] of mgr.meshById) out[id] = { sx: +m.scale.x.toFixed(3), px: Math.round(m.position.x), pz: Math.round(m.position.z) };
    return out;
  })()`);
  for (const [id, tr] of Object.entries(transforms)) {
    if (Math.abs(tr.sx - 1) > 0.001 || tr.px !== 0 || tr.pz !== 0) {
      throw new Error(`Building ${id} transform drifted (position bug): ${JSON.stringify(transforms)}`);
    }
  }
  console.log('FOCUS LOOK: J solid, others translucent, zero transform drift');

  /* --- Structural guards ---------------------------------------------------
   * (1) No window instance may float in mid-air: every one must sit inside
   *     some building's bounds (+2.2u tolerance for the wall offset).
   * (2) The sky dome must be un-clippable at the current orbit distance —
   *     a clipped dome used to show a white "globe" artifact in overview. */
  const structural = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const T = mgr.THREE;
    let total = 0, floating = 0;
    const boxes = [...mgr.buildingMeshes].map((m) => { const b = new T.Box3().setFromObject(m); b.expandByScalar(2.2); return b; });
    const m4 = new T.Matrix4();
    const p = new T.Vector3();
    for (const b of mgr._nightWindows || []) {
      for (let i = 0; i < b.inst.count; i++) {
        b.inst.getMatrixAt(i, m4);
        p.setFromMatrixPosition(m4);
        total++;
        if (!boxes.some((bx) => bx.containsPoint(p))) floating++;
      }
    }
    const worst = (mgr.sph?.dist || 0) + 3000;
    return { total, floating, domeOk: mgr.camera.far > worst + 200, worst: Math.round(worst), far: mgr.camera.far };
  })()`);
  if (structural.floating > 0) throw new Error(`${structural.floating}/${structural.total} window instances float in mid-air`);
  if (!structural.domeOk) throw new Error(`Sky dome can clip (far=${structural.far} worst=${structural.worst}) — white-globe artifact returns`);
  console.log(`STRUCTURE: ${structural.total} windows all wall-attached; dome un-clippable (far ${structural.far} > worst ${structural.worst})`);

  /* --- Day/night window behavior -------------------------------------------
   * Windows must be off (or near-off) in daylight and strongly lit at
   * night. Drive the real engine with a solar override instead of waiting
   * for the actual sun. */
  const lightStates = await evaluate(`(async () => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const out = {};
    /* Window opacity eases toward its target, so poll until the fade
     * converges (SwiftShader runs a few fps; real GPUs settle in <1s). */
    for (const [key, elev] of [['day', 42], ['night', -30]]) {
      mgr._solarOverride = { elevationDeg: elev, azimuthDeg: 180 };
      mgr._applyTimeOfDay();
      mgr._applyWeatherEnvironment();
      const wm = mgr._nightWindows?.[0]?.wm;
      let last = -1;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const cur = +(wm?.opacity ?? 0).toFixed(3);
        if (Math.abs(cur - last) < 0.015) break;
        last = cur;
      }
      out[key] = {
        nightF: +mgr._nightF.toFixed(3),
        windowOpacity: +(wm?.opacity ?? 0).toFixed(3),
        baseTarget: +(0.95 * mgr._nightF).toFixed(3)
      };
    }
    mgr._solarOverride = null;
    mgr._applyTimeOfDay();
    mgr._applyWeatherEnvironment();
    return out;
  })()`);
  if (lightStates.day.windowOpacity > 0.2) throw new Error(`Windows visible in daylight: ${JSON.stringify(lightStates)}`);
  if (lightStates.day.nightF > 0.15) throw new Error(`Daylight not detected by night factor: ${JSON.stringify(lightStates)}`);
  if (lightStates.night.windowOpacity < 0.55) throw new Error(`Windows not lit at night: ${JSON.stringify(lightStates)}`);
  console.log(`DAY/NIGHT: windows day=${lightStates.day.windowOpacity} night=${lightStates.night.windowOpacity} (nightF ${lightStates.day.nightF}/${lightStates.night.nightF})`);

  /* --- Celestial guard ------------------------------------------------------
   * (1) The sun glow must be bright in daylight, gone at night, and must NOT
   *     be fogged out (FogExp2 used to erase ~75% of the disc).
   * (2) The sprite must ride the camera along the sun direction so it stays
   *     aligned with the dome's disc from any orbit pose (at-infinity). */
  const celestial = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const dayState = (() => {
      mgr._solarOverride = { elevationDeg: 38, azimuthDeg: 225 };
      mgr._applyTimeOfDay();
      return { sunOpacity: +mgr.sunSprite.material.opacity.toFixed(3), fog: mgr.sunSprite.material.fog,
        starsW: +((1 - mgr.skyUniforms.uDayF.value)).toFixed(3) };
    })();
    const nightState = (() => {
      mgr._solarOverride = { elevationDeg: -32, azimuthDeg: 305 };
      mgr._applyTimeOfDay();
      return { sunOpacity: +mgr.sunSprite.material.opacity.toFixed(3),
        starsW: +((1 - mgr.skyUniforms.uDayF.value)).toFixed(3) };
    })();
    /* Alignment: off-axis orbit pose, sprite direction vs dome sun direction. */
    mgr.camera.position.set(700, 500, 900);
    mgr._applyTimeOfDay();
    const a = mgr.sunSprite.position.clone().sub(mgr.camera.position).normalize();
    const b = mgr.skyUniforms.uSunDir.value.clone().normalize();
    const angleDeg = +(Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180 / Math.PI).toFixed(2);
    mgr._solarOverride = null;
    mgr._applyTimeOfDay();
    return { dayState, nightState, angleDeg };
  })()`);
  if (celestial.dayState.sunOpacity < 0.3) throw new Error(`Sun glow invisible at 38deg elevation: ${JSON.stringify(celestial.dayState)}`);
  if (celestial.nightState.sunOpacity > 0.05) throw new Error(`Sun glow leaks at night: ${JSON.stringify(celestial.nightState)}`);
  if (celestial.dayState.fog !== false) throw new Error('Sun sprite is fogged (FogExp2 erases the disc)');
  if (celestial.dayState.starsW > 0.1 || celestial.nightState.starsW < 0.9) throw new Error(`Star weight wrong day/night: ${JSON.stringify(celestial)}`);
  if (celestial.angleDeg > 10) throw new Error(`Sun sprite misaligned with dome sun by ${celestial.angleDeg}deg`);
  console.log(`CELESTIAL: day sunOp=${celestial.dayState.sunOpacity} night sunOp=${celestial.nightState.sunOpacity} fogOff starsW ${celestial.dayState.starsW}/${celestial.nightState.starsW} align=${celestial.angleDeg}deg`);

  /* --- Theme accent follows --accent ----------------------------------------
   * Simulate switching the theme to red and confirm every glass body,
   * emissive and the selection color re-tint live (not fixed purple). */
  const accentTest = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const before = '#' + mgr.meshById.get('H').material.color.getHexString();
    const beforeGround = '#' + mgr.groundMat.color.getHexString();
    document.documentElement.style.setProperty('--accent', '#e23b3b');
    mgr.refreshAccent();
    const after = {
      glassH: '#' + mgr.meshById.get('H').material.color.getHexString(),
      glassJ: '#' + mgr.meshById.get('J').material.color.getHexString(),
      focusEmis: '#' + (mgr.focusId ? mgr.meshById.get(mgr.focusId).material.emissive.getHexString() : 'none'),
      accentStored: '#' + mgr.accentHex.getHexString(),
      ground: '#' + mgr.groundMat.color.getHexString(),
      ring: '#' + mgr.ringMat.color.getHexString(),
      grid: (() => { const c = mgr.grid.geometry.attributes.color; return '#' + new mgr.THREE.Color(c.getX(0), c.getY(0), c.getZ(0)).getHexString(); })()
    };
    document.documentElement.style.setProperty('--accent', mgr._prevAccent || before);
    mgr.refreshAccent();
    return { before, beforeGround, after };
  })()`);
  /* Glass = accent lerped toward white (linear-space), so assert the red
   * hue family rather than an exact hex. */
  const hex = accentTest.after.glassH.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (!(r > b + 40 && r > g + 40)) throw new Error(`Glass did not follow red accent: ${JSON.stringify(accentTest)}`);
  if (accentTest.before === accentTest.after.glassH) throw new Error(`Accent refresh produced no color change: ${JSON.stringify(accentTest)}`);
  /* Floor / grid / rim ring must follow the theme as well. */
  const hueOf = (h) => { const n = parseInt(h.replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; let hh = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; return ((hh * 60) + 360) % 360; };
  /* Circular hue distance: red 350deg is 10deg from 0, not 350. */
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const redHue = 0, purpleHue = 265;
  if (hueDist(hueOf(accentTest.after.ground), redHue) > 40) throw new Error(`Ground did not follow red accent: ${JSON.stringify(accentTest.after)}`);
  if (hueDist(hueOf(accentTest.after.ring), redHue) > 40) throw new Error(`Rim ring did not follow red accent: ${JSON.stringify(accentTest.after)}`);
  /* GridHelper bakes colors into vertex attributes; material.color is unused. */
  if (hueDist(hueOf(accentTest.after.grid), redHue) > 40) throw new Error(`Grid did not follow red accent: ${JSON.stringify(accentTest.after)}`);
  if (hueDist(hueOf(accentTest.beforeGround), purpleHue) > 45) throw new Error(`Ground was not accent-tinted before the switch: ${accentTest.beforeGround}`);
  console.log(`ACCENT: glass ${accentTest.before} -> red-theme ${accentTest.after.glassH}; ground ${accentTest.beforeGround} -> ${accentTest.after.ground}; grid/ring follow`);
  const focusBtn = await evaluate(`(() => ({
    segments: Number(document.querySelector('#cm3d-mount')?.dataset.pathSegments || 0),
    btnHidden: document.querySelector('.cm3d-path-toggle')?.classList.contains('is-hidden') ?? null
  }))()`);
  if (!focusBtn.segments || focusBtn.btnHidden !== false) throw new Error(`Focus did not show route + toggle button: ${JSON.stringify(focusBtn)}`);
  console.log(`ROUTE VISIBILITY: hidden at overview, shown on focus (${focusBtn.segments} segment, button visible)`);

  const ringVisible = await evaluate(`!!window.__SC_CAMPUS_MAP_3D__?.focusRing?.visible`);
  if (!ringVisible) throw new Error('Focus targeting ring did not appear on selection');
  if (!focus.status || /Overview\. Tap a building/i.test(focus.status)) throw new Error(`Focus status line not updated: "${focus.status}"`);

  /* Quick-select chips: clicking one must focus that building and show its
   * route — the no-hunting path into the map. Re-focuses to C; the toggle
   * and reset steps below are building-agnostic. */
  const chip = await evaluate(`(async () => {
    const btn = document.querySelector('[data-map-chip="C"]');
    if (!btn) return null;
    btn.click();
    await new Promise((r) => setTimeout(r, 1600));
    const mount = document.querySelector('#cm3d-mount');
    return {
      exists: true,
      focusBuilding: mount?.dataset.focusBuilding || '',
      segments: Number(mount?.dataset.pathSegments || 0)
    };
  })()`);
  if (!chip?.exists) throw new Error('Quick-select chips missing from the map widget');
  if (chip.focusBuilding !== 'C' || !chip.segments) throw new Error(`Chip selection failed: ${JSON.stringify(chip)}`);
  console.log(`CHIPS: quick-select C -> focus + route (${chip.segments} segment)`);

  /* Arrow orientation guard: cone tips (+Z) must aim ALONG the travel
   * tangent — a Matrix4.lookAt argument swap once pointed them backwards. */
  const orient = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const T = mgr.THREE;
    const entry = mgr.routeArrows[mgr.routeArrows.length - 1];
    if (!entry) return null;
    const m4 = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3();
    const axis = new T.Vector3(0, 0, 1), wa = new T.Vector3();
    const flow = (mgr.clockUniform.value * 0.042) % 1;
    let min = 1, sum = 0, n = 0;
    for (let i = 0; i < entry.inst.count; i += 3) {
      entry.inst.getMatrixAt(i, m4);
      m4.decompose(p, q, sc);
      wa.copy(axis).applyQuaternion(q);
      const d = wa.dot(entry.curve.getTangentAt((entry.t[i] + flow) % 1));
      min = Math.min(min, d); sum += d; n++;
    }
    return { avg: sum / n, min, count: entry.inst.count };
  })()`);
  if (!orient || orient.avg < 0.9 || orient.min < 0.85) throw new Error(`Arrows misoriented: ${JSON.stringify(orient)}`);
  console.log(`ARROWS: ${orient.count} instanced, pointing along travel (avg dot ${orient.avg.toFixed(2)}, min ${orient.min.toFixed(2)})`);

  /* Sky coverage guard: the dome must paint a real gradient, never a flat
   * wash. Tilt the rig up first so both sample rows are pure sky (at the
   * overview pose the lower row reads ground, which is darker than sky). */
  const sky = await evaluate(`(async () => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const canvas = document.querySelector('.cm3d-canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const lumAt = (y) => { mgr.renderer.render(mgr.scene, mgr.camera); gl.readPixels((w / 2) | 0, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; };
    /* Level view from the camera's own height: the frame's top samples
     * mid-elevation sky, the 55% row samples just above the horizon —
     * both guaranteed sky, and the gradient is maximal between them. */
    const THREE = mgr.THREE;
    const up = new THREE.Vector3(mgr.camTarget.x, mgr.camera.position.y, mgr.camTarget.z);
    mgr.camera.lookAt(up);
    const out = { top: +lumAt(h - 4).toFixed(1), mid: +lumAt((h * 0.55) | 0).toFixed(1), accent: '#' + mgr.skyUniforms.uAccent.value.getHexString() };
    mgr.camera.lookAt(mgr.camTarget);
    return out;
  })()`);
  if (!(sky.top < sky.mid)) throw new Error(`Sky gradient flat or inverted: ${JSON.stringify(sky)}`);
  if (sky.top < 8 || sky.top > 250) throw new Error(`Sky zenith out of readable range: ${JSON.stringify(sky)}`);
  console.log(`SKY: gradient present (zenith ${sky.top} < horizon ${sky.mid}), accent-linked (${sky.accent})`);

  const pathToggle = await evaluate(`(() => {
    const button = document.querySelector('.cm3d-path-toggle');
    const mount = document.querySelector('#cm3d-mount');
    const before = mount?.dataset.pathVisible === 'true';
    button?.click();
    return { before, after: mount?.dataset.pathVisible === 'false', classOff: button?.classList.contains('is-off') };
  })()`);
  if (!pathToggle.before || !pathToggle.after || !pathToggle.classOff) throw new Error(`Wayfinding toggle failed: ${JSON.stringify(pathToggle)}`);

  const reset = await evaluate(`(async () => {
    document.querySelector('.cm3d-reset')?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const mount = document.querySelector('#cm3d-mount');
    return {
      overview: (document.getElementById('cm-status-text')?.textContent || '').includes('Overview') || mount?.dataset.cameraMode === 'overview',
      cameraMode: mount?.dataset.cameraMode || '',
      focusBuilding: mount?.dataset.focusBuilding || '',
      pathVisible: mount?.dataset.pathVisible === 'false',
      segments: Number(mount?.dataset.pathSegments || 0),
      btnHidden: document.querySelector('.cm3d-path-toggle')?.classList.contains('is-hidden') ?? null
    };
  })()`);
  if (!reset.overview || reset.cameraMode !== 'overview' || reset.focusBuilding) throw new Error(`Camera reset failed: ${JSON.stringify(reset)}`);
  if (reset.segments || reset.btnHidden !== true) throw new Error(`Reset left the route or toggle visible: ${JSON.stringify(reset)}`);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const rig = await evaluate(`(() => {
    const mgr = window.__SC_CAMPUS_MAP_3D__;
    const c = mgr.camTarget, W = mgr.WORLD || { w: 930, h: 1000 };
    return { dist: Math.round(mgr.sph.dist), lookCenter: Math.abs(c.x - W.w / 2) < 4 && Math.abs(c.z - W.h / 2) < 4,
      pitch: +mgr.sph.pitch.toFixed(2), solarElev: mgr._solarElevation != null ? Math.round(mgr._solarElevation) : null };
  })()`);
  if (!rig.lookCenter) throw new Error(`Reset does not re-center the map: ${JSON.stringify(rig)}`);
  if (!(rig.dist > 1300 && rig.dist < 1800)) throw new Error(`Reset distance wrong: ${JSON.stringify(rig)}`);
  if (rig.solarElev == null) throw new Error(`Solar engine not reporting elevation: ${JSON.stringify(rig)}`);
  console.log(`RIG: overview dist=${rig.dist} pitch=${rig.pitch} look=center solarElev=${rig.solarElev}deg`);

  /* Automated environment: time-of-day engine and snowfall must be live. */
  const environment = await evaluate(`(() => {
    const manager = window.__SC_CAMPUS_MAP_3D__;
    return {
      tod: manager?._todKeys || '',
      fogIsExp2: manager?.scene?.fog?.isFogExp2 === true,
      particles: manager?.snow?.isPoints === true,
      particleMode: manager?._particleMode || 'none',
      weatherCondition: manager?.weatherCondition || document.querySelector('#cm3d-mount')?.dataset.weatherCondition || '',
      arrows: manager?.routeArrows === null ? -1 : (manager?.routeArrows?.length ?? -1),
      wireframes: manager?.scene ? true : false,
      composer: !!manager?.composer,
      bloom: manager?.bloomPass?.isPass === true || manager?.bloomPass != null,
      toneMappingAces: manager?.renderer?.toneMapping === manager?.THREE?.ACESFilmicToneMapping,
      hemi: manager?.hemi?.isHemisphereLight === true,
      dust: manager?.dust?.isPoints === true,
      windowGlow: manager?.windowGlow?.length ?? -1,
      focusRing: !!manager?.focusRing
    };
  })()`);
  if (!environment.tod || !environment.fogIsExp2) throw new Error(`Environment engine missing: ${JSON.stringify(environment)}`);
  /* Particles are weather-driven: snow in real snowfall, rain in rain/thunder,
   * none otherwise. Assert the mode matches the live condition. */
  const expectedMode = environment.weatherCondition === 'snow' ? 'snow'
    : (environment.weatherCondition === 'rain' || environment.weatherCondition === 'thunder') ? 'rain' : 'none';
  if (environment.particleMode !== expectedMode) throw new Error(`Particle mode ${environment.particleMode} does not match condition ${environment.weatherCondition} (expected ${expectedMode})`);
  /* Arrows are selection-bound now: the final state is post-reset (nothing
   * selected), so 0 arrows is correct. Arrow presence during focus is
   * asserted by the ROUTE VISIBILITY step above. */
  if (environment.arrows !== 0) throw new Error(`Route should be cleared after reset: ${JSON.stringify(environment)}`);
  /* Post-processing is tier-aware: full bloom on real GPUs, ACES-only lite
   * tier on software rasterizers where fullscreen blur passes are ruinous. */
  const softwareGpu = await evaluate(`window.__SC_CAMPUS_MAP_3D__?.softwareGpu === true`);
  if (softwareGpu) {
    if (environment.composer) throw new Error(`Bloom enabled on software renderer — adaptive tier failed: ${JSON.stringify(environment)}`);
    console.log('POSTFX: lite tier (software rasterizer) — ACES tone mapping on, bloom skipped by design');
  } else if (!environment.composer || !environment.bloom || !environment.toneMappingAces) {
    throw new Error(`Post-processing chain missing: ${JSON.stringify(environment)}`);
  } else {
    console.log('POSTFX: full tier — EffectComposer + UnrealBloom + ACES tone mapping');
  }
  if (!environment.hemi) throw new Error(`Hemisphere fill light missing: ${JSON.stringify(environment)}`);
  if (!environment.dust) throw new Error(`Ambient dust layer missing: ${JSON.stringify(environment)}`);
  if (!(environment.windowGlow > 0)) throw new Error(`Window glow panels missing: ${JSON.stringify(environment)}`);
  console.log(`ENVIRONMENT: tod=${environment.tod} condition=${environment.weatherCondition} particles=${environment.particleMode} arrows=${environment.arrows} windows=${environment.windowGlow} bloom=on aces=on dust=on`);

  /* Performance smoke check: sample the RAF cadence on a freshly reloaded
   * page. Mid-test manager re-mounts (the app's minute clock) can leave
   * several WebGL contexts sharing the software rasterizer, which poisons
   * the measurement — a fresh single context is the comparable condition.
   * Under SwiftShader this is an order of magnitude slower than any real
   * GPU, so the threshold is deliberately conservative. */
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await evaluate(`document.querySelector('[data-nav="today"]')?.click()`);
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await evaluate(`!!window.__SC_CAMPUS_MAP_3D__?.ready && (window.__SC_CAMPUS_MAP_3D__?.meshById?.size || 0) > 0`).catch(() => false)) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  const fps = await evaluate(`(async () => {
    /* Best-of-3: shared CI hosts are scheduler-noisy, and a single window
     * can land on a throttled slice. The best sample reflects the scene's
     * real cost, not background load. */
    const sample = () => new Promise((res) => {
      let frames = 0; const start = performance.now();
      const step = () => { frames++; (performance.now() - start < 1800) ? requestAnimationFrame(step) : res(Math.round(frames / ((performance.now() - start) / 1000))); };
      requestAnimationFrame(step);
    });
    return Math.max(await sample(), await sample(), await sample());
  })()`);
  /* Floor 8: catches catastrophic scene regressions (incident history: 3fps).
   * SwiftShader best-of-3 on a shared CI box wobbles 10-13fps; real GPUs run
   * an order of magnitude faster and are not gated here. */
  if (!(fps >= 8)) throw new Error(`Frame rate too low even for software rendering: ${fps} fps`);
  console.log(`PERF: ~${fps} fps under SwiftShader at desktop size (bloom + particles live)`);

  /* Geometry fidelity vs the traced Davis plan: the 3D scene maps SVG space
   * to world space 1:1 (X -> X, Y -> Z), so every building's world footprint
   * must match its traced SVG footprint (bevel adds ~2.5u per side). */
  const geometry = await evaluate(`(async () => {
    const manager = window.__SC_CAMPUS_MAP_3D__;
    const THREE = manager.THREE;
    const svgNS = 'http://www.w3.org/2000/svg';
    const tmpSvg = document.createElementNS(svgNS, 'svg');
    tmpSvg.style.position = 'absolute'; tmpSvg.style.opacity = '0'; tmpSvg.style.pointerEvents = 'none';
    document.body.appendChild(tmpSvg);
    const rows = [];
    for (const [id, b] of Object.entries(manager.opts.getBuildings())) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', b.d);
      tmpSvg.appendChild(path);
      const sb = path.getBBox();
      const mesh = manager.meshById.get(id);
      if (!mesh) { rows.push({ id, error: 'no mesh' }); continue; }
      const wb = new THREE.Box3().setFromObject(mesh);
      const size = wb.getSize(new THREE.Vector3());
      const center = wb.getCenter(new THREE.Vector3());
      rows.push({
        id,
        svg: { cx: +(sb.x + sb.width / 2).toFixed(1), cy: +(sb.y + sb.height / 2).toFixed(1), w: +sb.width.toFixed(1), h: +sb.height.toFixed(1) },
        world: { cx: +center.x.toFixed(1), cz: +center.z.toFixed(1), w: +size.x.toFixed(1), d: +size.z.toFixed(1), h: +size.y.toFixed(1) }
      });
    }
    tmpSvg.remove();
    const ground = manager.ground;
    const gb = ground ? new THREE.Box3().setFromObject(ground) : null;
    return { rows, groundRadius: ground ? ground.geometry.parameters.radius : null };
  })()`);
  if (!geometry || !Array.isArray(geometry.rows) || geometry.rows.length !== 6) throw new Error(`Geometry audit failed to run: ${JSON.stringify(geometry)}`);
  const BEVEL = 6.5; /* bevelSize 2.5 + bevelThickness ~3 + wireframe rounding slack */
  for (const row of geometry.rows) {
    if (row.error) throw new Error(`Building ${row.id}: ${row.error}`);
    if (Math.abs(row.world.cx - row.svg.cx) > BEVEL) throw new Error(`Building ${row.id} X center drift: svg=${row.svg.cx} world=${row.world.cx}`);
    if (Math.abs(row.world.cz - row.svg.cy) > BEVEL) throw new Error(`Building ${row.id} Z center drift: svg=${row.svg.cy} world=${row.world.cz}`);
    if (Math.abs(row.world.w - row.svg.w) > BEVEL) throw new Error(`Building ${row.id} width mismatch: svg=${row.svg.w} world=${row.world.w}`);
    if (Math.abs(row.world.d - row.svg.h) > BEVEL) throw new Error(`Building ${row.id} depth mismatch: svg=${row.svg.h} world=${row.world.d}`);
    if (row.world.h < 20 || row.world.h > 80) throw new Error(`Building ${row.id} implausible height: ${row.world.h}`);
  }
  /* Every footprint must sit inside the campus ground disc. */
  for (const row of geometry.rows) {
    const dx = row.world.cx - 465, dz = row.world.cz - 500;
    if (Math.hypot(dx, dz) + Math.max(row.world.w, row.world.d) / 2 > geometry.groundRadius) {
      throw new Error(`Building ${row.id} extends beyond the campus ground disc`);
    }
  }
  console.log('GEOMETRY: all 6 footprints match traced SVG space (1:1 world mapping, within bevel tolerance); inside ground disc');

  /* Responsive scaling: emulate a phone and confirm the renderer resizes with
   * the window resize listener and the HUD stays usable. */
  const desktopWidth = await evaluate(`document.querySelector('.cm3d-canvas')?.clientWidth || 0`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const mobile = await evaluate(`(() => {
    const manager = window.__SC_CAMPUS_MAP_3D__;
    const canvas = document.querySelector('.cm3d-canvas');
    return {
      width: canvas?.clientWidth || 0,
      rendererWidth: manager?.renderer?.domElement?.width || 0,
      hud: document.querySelectorAll('.cm3d-hud button').length,
      ready: manager?.ready === true,
      composerAlive: !!manager?.composer,
      dustAlive: manager?.dust?.isPoints === true,
      isMobileTier: manager?.isMobile === true
    };
  })()`);
  if (!mobile.ready || mobile.hud !== 2) throw new Error(`Mobile HUD broken: ${JSON.stringify(mobile)}`);
  if (!mobile.dustAlive) throw new Error(`Mobile atmosphere lost after resize: ${JSON.stringify(mobile)}`);
  if (!softwareGpu && !mobile.composerAlive) throw new Error(`Mobile composer lost after resize: ${JSON.stringify(mobile)}`);
  if (!(mobile.width > 150 && mobile.width < desktopWidth)) throw new Error(`Mobile resize failed: ${JSON.stringify({ desktopWidth, mobile })}`);
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join('; ')}`);

  console.log(JSON.stringify({ overview, hit: { x: Math.round(hit.x), y: Math.round(hit.y) }, focus, pathToggle, reset, environment, desktopWidth, mobile, browserErrors: [] }));
} finally {
  ws.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
