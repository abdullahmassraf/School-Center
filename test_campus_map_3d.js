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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push('console.error');
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
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await evaluate(`!!document.querySelector('.cm3d-canvas')`)) break;
  }
  /* Wait for full init (THREE module import + building extrusion), not just
   * canvas presence — a fixed sleep races SwiftShader/CDN timing. */
  for (let i = 0; i < 40; i++) {
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
      pathVisible: document.querySelector('#cm3d-mount')?.dataset.pathVisible !== 'false'
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
  if (!overview.pathSegments || !overview.pathVisible) throw new Error(`Initial wayfinding path missing: ${JSON.stringify(overview)}`);
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
  let hit = await evaluate(`(() => {
    const manager = window.__SC_CAMPUS_MAP_3D__;
    const mesh = manager?.meshById?.get('J');
    const canvas = document.querySelector('.cm3d-canvas');
    if (!manager || !mesh || !canvas) return null;
    const box = new manager.THREE.Box3().setFromObject(mesh);
    const point = box.getCenter(new manager.THREE.Vector3()).project(manager.camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * 0.5 * rect.width, y: rect.top + (1 - point.y) * 0.5 * rect.height };
  })()`).catch(() => null);
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
  if (!focus.status || /Overview\. Tap a building/i.test(focus.status)) throw new Error(`Focus status line not updated: "${focus.status}"`);

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
      pathVisible: mount?.dataset.pathVisible === 'false'
    };
  })()`);
  if (!reset.overview || reset.cameraMode !== 'overview' || reset.focusBuilding) throw new Error(`Camera reset failed: ${JSON.stringify(reset)}`);

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
      wireframes: manager?.scene ? true : false
    };
  })()`);
  if (!environment.tod || !environment.fogIsExp2) throw new Error(`Environment engine missing: ${JSON.stringify(environment)}`);
  /* Particles are weather-driven: snow in real snowfall, rain in rain/thunder,
   * none otherwise. Assert the mode matches the live condition. */
  const expectedMode = environment.weatherCondition === 'snow' ? 'snow'
    : (environment.weatherCondition === 'rain' || environment.weatherCondition === 'thunder') ? 'rain' : 'none';
  if (environment.particleMode !== expectedMode) throw new Error(`Particle mode ${environment.particleMode} does not match condition ${environment.weatherCondition} (expected ${expectedMode})`);
  if (environment.arrows <= 0) throw new Error(`Wayfinding arrows missing: ${JSON.stringify(environment)}`);
  console.log(`ENVIRONMENT: tod=${environment.tod} condition=${environment.weatherCondition} particles=${environment.particleMode} arrows=${environment.arrows}`);

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
      ready: manager?.ready === true
    };
  })()`);
  if (!mobile.ready || mobile.hud !== 2) throw new Error(`Mobile HUD broken: ${JSON.stringify(mobile)}`);
  if (!(mobile.width > 150 && mobile.width < desktopWidth)) throw new Error(`Mobile resize failed: ${JSON.stringify({ desktopWidth, mobile })}`);
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join('; ')}`);

  console.log(JSON.stringify({ overview, hit: { x: Math.round(hit.x), y: Math.round(hit.y) }, focus, pathToggle, reset, environment, desktopWidth, mobile, browserErrors: [] }));
} finally {
  ws.close();
  browser.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
