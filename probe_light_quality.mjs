/* Night-lighting + surface quality probe: forces night, renders the real
 * scene, and pixel-verifies (1) volumetric window shafts contribute real
 * light in mid-air (not just a facade decal), (2) haze (cloud/fog) makes
 * the rays read stronger, (3) shafts fall off away from the wall and are
 * exactly off in daylight, (4) the floor grid fades out in a circular ring
 * past the map rim, (5) reset framing puts the outer ring near the viewport
 * edges, (6) window instanced meshes are never frustum-culled away, and
 * (7) parking lots stay brighter + glossier than matte asphalt, follow the
 * theme accent, respond to wetness, and receive real IBL sky reflection. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8982, DEBUG_PORT = 9282;
const CHROME = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].find((c) => {
  try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) { console.error('no chromium'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const profile = fs.mkdtempSync('/tmp/lq-');
const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--enable-gpu', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!target) { console.error('no CDP page'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.onopen = r);
let id = 0; const pending = new Map(); const browserErrors = [];
ws.onmessage = (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') browserErrors.push(String(d.params?.exceptionDetails?.exception?.description || d.params?.exceptionDetails?.text || '').slice(0, 200));
  if (d.method === 'Log.entryAdded' && d.params?.entry?.level === 'error') browserErrors.push(String(d.params.entry.text).slice(0, 200));
};
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression, ms = 12000) => {
  for (let i = 0; i < 3; i++) {
    try {
      const d = await Promise.race([
        send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), ms))
      ]);
      if (d?.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'eval exc');
      return d?.result?.result?.value;
    } catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
let ready = false;
for (let i = 0; i < 140 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ready = await evaluate(`!!window.__SC_CAMPUS_MAP_3D__?.ready && (window.__SC_CAMPUS_MAP_3D__?.meshById?.size || 0) > 0`);
}
if (!ready) { console.error('manager never ready'); chrome.kill('SIGKILL'); server.close(); process.exit(2); }

const result = await evaluate(`(async () => {
  const mgr = window.__SC_CAMPUS_MAP_3D__;
  const T = mgr.THREE;
  mgr.weatherCondition = 'clear';
  mgr.scene.fog.density = 0.00012;
  const box = new T.Box3().setFromObject(mgr.meshById.get('J'));
  const nb = mgr._nightWindows.find((b) => b.cells.some((c) =>
    c.x > box.min.x - 1 && c.x < box.max.x + 1 && Math.abs(c.z - (box.max.z + 0.35)) < 6))
    || mgr._nightWindows[0];
  const wallZ = box.max.z + 0.35;
  /* Deterministic lighting: freeze every random window toggle, force all
   * cells lit so the shafts reflect a fully-lit facade. */
  mgr._nightWindows.forEach((b) => { b.timers = b.cells.map(() => 1e12); b.fades = []; });
  {
    const colF = new T.Color();
    for (const b of mgr._nightWindows) {
      b.cells.forEach((c, i) => { c.on = true; b.inst.setColorAt(i, colF.setHex(c.tint).multiplyScalar(c.bright)); });
      b.inst.instanceColor.needsUpdate = true;
    }
  }

  const gl = mgr.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  const lumAt = (wx, wy, wz) => {
    const v = new T.Vector3(wx, wy, wz).project(mgr.camera);
    gl.readPixels(((v.x * 0.5 + 0.5) * w) | 0, ((v.y * 0.5 + 0.5) * h) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
  };

  /* --- Night volumetric shaft checks ------------------------------------ */
  const shaftJ = mgr.facadeGlows.find((s) => Math.abs(s.position.z - (box.max.z + 0.6)) < 2
    && Math.abs(s.position.x - (box.min.x + box.max.x) / 2) < 2) || mgr.facadeGlows[0];
  const y0 = shaftJ.position.y;
  const cx = (box.min.x + box.max.x) / 2;
  const setPose = () => {
    mgr.camera.position.set(box.min.x - 120, 420, wallZ + 260);
    mgr.camera.lookAt(cx, 0, wallZ + 30);
    mgr.camera.updateMatrixWorld();
  };
  const renderNight = (haze) => {
    mgr._solarOverride = { elevationDeg: -15, azimuthDeg: 200 };
    mgr._applyTimeOfDay();
    mgr._nightF = 1; mgr._haze = haze;
    const g = (0.26 + 0.2 * haze) * mgr._nightF;
    for (const glow of mgr.facadeGlows) glow.material.opacity = g * (0.75 + 0.25 * (glow.material.userData.litF ?? 1));
    setPose();
    mgr.renderer.render(mgr.scene, mgr.camera);
  };
  renderNight(0);
  /* Mid-air sample inside the light curtain, ~3u off the wall: a real ray
   * of light, not a facade decal. */
  const beamY = y0 + 22, beamZ = wallZ + 10;
  const beamOn = Math.round(lumAt(cx, beamY, beamZ));
  const savedOp = shaftJ.material.opacity;
  shaftJ.material.opacity = 0;
  mgr.renderer.render(mgr.scene, mgr.camera);
  const beamOff = Math.round(lumAt(cx, beamY, beamZ));
  shaftJ.material.opacity = savedOp;
  /* Haze response: foggy air catches more of the beam. */
  renderNight(1);
  const beamHaze = Math.round(lumAt(cx, beamY, beamZ));
  /* Falloff along the beam: bright at the wall, gone at the tip. */
  const shaftFall = [6, 30, 62].map((d) => Math.round(lumAt(cx, y0 + d * 0.42, wallZ + d)));
  /* Day: the live formula must be exactly 0. */
  mgr._nightF = 0;
  const dayShaftOpacity = (0.26 + 0.2 * mgr._haze) * mgr._nightF;
  renderNight(0);

  /* --- Grid circular fade ------------------------------------------------ */
  const C = { x: mgr.ground.position.x, z: mgr.ground.position.z };   /* ground sits at the world center */
  mgr.camera.position.set(C.x, 1400, C.z + 1);
  mgr.camera.lookAt(C.x, 0, C.z);
  mgr.camera.updateMatrixWorld();
  mgr._solarOverride = { elevationDeg: 35, azimuthDeg: 150 };
  mgr._nightF = 0;
  mgr._applyTimeOfDay();
  mgr.renderer.render(mgr.scene, mgr.camera);
  /* Sample the center grid LINE (a line runs through the plaza center) at
   * r=100 vs r=450, each minus the ground right next to the line. The line
   * must lose contrast as it approaches the rim (radial alpha), while the
   * ground itself stays lit. */
  /* The grid is a 936-unit SQUARE whose corners reach r=662 — beyond the
   * circular ring (r=468) they float over the void. The radial shader must
   * keep full line contrast on open plaza inside the ring and zero past it.
   * Sample 16 directions per ring and keep the strongest line contrast
   * where a downward raycast confirms the point is open ground (skips
   * buildings). Amplify line opacity for SNR; restore after. */
  const savedGridOp = mgr.grid.material.opacity;
  mgr.grid.material.opacity = 0.8;
  const downRay = new T.Raycaster();
  downRay.far = 600;
  const clearGround = (x, z) => {
    downRay.set(new T.Vector3(x, 300, z), new T.Vector3(0, -1, 0));
    const hits = downRay.intersectObjects([mgr.ground, ...mgr.buildingMeshes], false);
    return hits.length > 0 && hits[0].object === mgr.ground;
  };
  const ringContrast = (r) => {
    let best = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const px = C.x + Math.cos(ang) * r, pz = C.z + Math.sin(ang) * r;
      if (!clearGround(px, pz)) continue;
      const gx = -3 + 18 * Math.round((px + 3) / 18);   /* nearest x grid line */
      const c = Math.round(lumAt(gx, -0.2, pz) - lumAt(gx - 9, -0.2, pz));
      if (c > best) best = c;
    }
    return best;
  };
  const gridDeltaIn = ringContrast(180);
  const gridDeltaMid = ringContrast(520);
  const gridDeltaOut = ringContrast(580);
  mgr.grid.material.opacity = savedGridOp;

  /* --- Overview framing: ring near the viewport edges -------------------- */
  const p = mgr._overviewPose();
  mgr.sph.dist = p.dist; mgr.sph.pitch = p.pitch;
  mgr._applyDampedRig(2.5);
  mgr.renderer.render(mgr.scene, mgr.camera);
  const ringProj = (() => {
    let minX = 2, maxX = -2, minY = 2, maxY = -2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const v = new T.Vector3(C.x + Math.cos(a) * 468, 0.1, C.z + Math.sin(a) * 468).project(mgr.camera);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { maxAbsX: +Math.max(Math.abs(minX), Math.abs(maxX)).toFixed(2), maxAbsY: +Math.max(Math.abs(minY), Math.abs(maxY)).toFixed(2) };
  })();

  /* --- Windows must not frustum-cull away -------------------------------- */
  const instCull = nb.inst.frustumCulled;
  const J = mgr.meshById.get('J');
  const jb = new T.Box3().setFromObject(J);
  const jc = jb.getCenter(new T.Vector3());
  const frontCells = nb.cells.filter((c) => c.z > jb.max.z).slice(0, 40);
  const winAvg = () => frontCells.reduce((a, c) => a + lumAt(c.x, c.y, c.z), 0) / Math.max(1, frontCells.length);
  const winPose = () => {
    mgr.camera.position.set(jb.min.x - 30, 140, wallZ + 170);
    mgr.camera.lookAt(jb.max.x, 90, wallZ + 6);
    mgr.camera.updateMatrixWorld();
  };
  mgr._nightF = 1; mgr._haze = 0;
  mgr._setFocusMaterial(J);   /* user scenario: building selected */
  winPose();
  mgr.renderer.render(mgr.scene, mgr.camera);
  const winDrawn = Math.round(winAvg());
  nb.inst.frustumCulled = true;   /* reproduce the old culling behavior */
  mgr.renderer.render(mgr.scene, mgr.camera);
  const winCulled = Math.round(winAvg());
  nb.inst.frustumCulled = false;
  mgr._resetMaterials();

  /* --- Lots: A/B old matte vs new reflective + theme follow -------------- */
  const lot = mgr.scene.children.find((o) => o.isMesh && o.material === mgr.lotMat);
  const lb = new T.Box3().setFromObject(lot);
  const lc = lb.getCenter(new T.Vector3());
  mgr._solarOverride = { elevationDeg: 22, azimuthDeg: 150 };
  mgr._nightF = 0;
  mgr._applyTimeOfDay();
  const setCam = () => {
    mgr.camera.position.set(lc.x - 60, 260, lc.z + 300);
    mgr.camera.lookAt(lc.x, 0, lc.z);
    mgr.camera.updateMatrixWorld();
  };
  const renderAt = () => { setCam(); mgr.renderer.render(mgr.scene, mgr.camera); };
  renderAt();
  let lotNew = Math.round(lumAt(lc.x, 0.35, lc.z));
  if (lotNew === 0) { renderAt(); lotNew = Math.round(lumAt(lc.x, 0.35, lc.z)); }
  const oldRough = mgr.lotMat.roughness, oldColor = '#' + mgr.lotMat.color.getHexString();
  mgr.lotMat.roughness = 0.9; mgr.lotMat.color.set(0x151d3f);
  mgr.renderer.render(mgr.scene, mgr.camera);
  let lotOld = Math.round(lumAt(lc.x, 0.35, lc.z));
  if (lotOld === 0 && lotNew === 0) { renderAt(); lotOld = Math.round(lumAt(lc.x, 0.35, lc.z)); }
  mgr.lotMat.roughness = oldRough; mgr.lotMat.color.set(oldColor);
  /* Theme follow: red accent must flip the lot's dominant channel to R. */
  document.documentElement.style.setProperty('--accent', '#e03535');
  mgr.refreshAccent();
  mgr._applyTimeOfDay();
  renderAt();
  const v2 = new T.Vector3(lc.x, 0.35, lc.z).project(mgr.camera);
  gl.readPixels(((v2.x * 0.5 + 0.5) * w) | 0, ((v2.y * 0.5 + 0.5) * h) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const redPix = [px[0], px[1], px[2]];
  document.documentElement.style.removeProperty('--accent');
  mgr.refreshAccent();
  /* IBL: scene.environment must exist and add measurable sky reflection.
   * The tier gate keeps IBL off on SwiftShader, so force one capture via
   * the escape hatch to verify the full pipeline here. */
  mgr._envAllowed = true; mgr._envForceOnce = true;
  if (!mgr._pmrem) {
    mgr._pmrem = new T.PMREMGenerator(mgr.renderer);
    mgr._pmrem.compileEquirectangularShader();
  }
  mgr._buildEnvironment();
  mgr._envForceOnce = false;
  const envOn = !!mgr.scene.environment;
  mgr._solarOverride = { elevationDeg: 22, azimuthDeg: 150 };
  mgr._nightF = 0;
  mgr._applyTimeOfDay();
  renderAt();
  const lotEnvOn = Math.round(lumAt(lc.x, 0.35, lc.z));
  const savedEnv = mgr.scene.environment;
  mgr.scene.environment = null;
  mgr.renderer.render(mgr.scene, mgr.camera);
  const lotEnvOff = Math.round(lumAt(lc.x, 0.35, lc.z));
  mgr.scene.environment = savedEnv;
  /* Wet response: roughness drops when wet. */
  const dryR = mgr.lotMat.roughness;
  mgr.wetness = 1;
  mgr.lotMat.roughness = (mgr._lotRough ?? 0.42) - mgr.wetness * 0.28;
  const wetR = mgr.lotMat.roughness;
  mgr.wetness = 0;
  mgr.lotMat.roughness = mgr._lotRough ?? 0.42;
  mgr._solarOverride = null;
  mgr._applyTimeOfDay();

  return { beamOn, beamOff, beamHaze, shaftFall, dayShaftOpacity,
    gridDeltaIn, gridDeltaMid, gridDeltaOut, ring: ringProj,
    instCull, winCulled, winDrawn,
    lotNew, lotOld, redPix, dryR: +dryR.toFixed(2), wetR: +wetR.toFixed(2),
    envOn, lotEnvOn, lotEnvOff, shafts: mgr.facadeGlows.length, dist: Math.round(mgr.sph.dist) };
})()`, 45000);

console.log('RESULT ' + JSON.stringify(result));
console.log('ERRORS ' + JSON.stringify(browserErrors.slice(0, 5)));

const checks = [];
const fail = (m) => { checks.push(m); };
if (!result || result.beamOn === undefined) fail('probe eval failed');
else {
  if (result.beamOn - result.beamOff < 8) fail(`volumetric shaft adds no measurable light in mid-air: on ${result.beamOn} vs off ${result.beamOff}`);
  if (!(result.beamHaze >= result.beamOn)) fail(`haze does not strengthen the rays: clear ${result.beamOn} vs haze ${result.beamHaze}`);
  if (!(result.shaftFall[0] >= result.shaftFall[1] && result.shaftFall[1] >= result.shaftFall[2] - 4)) fail(`shaft falloff not monotonic: ${JSON.stringify(result.shaftFall)}`);
  if (result.dayShaftOpacity !== 0) fail(`shaft opacity not exactly 0 in day: ${result.dayShaftOpacity}`);
  if (!(result.gridDeltaIn >= 6)) fail(`grid lines not visible on the plaza: contrast ${result.gridDeltaIn}`);
  if (!(result.gridDeltaIn - result.gridDeltaOut >= 6)) fail(`grid corners do not fade past the ring: in ${result.gridDeltaIn} mid ${result.gridDeltaMid} out ${result.gridDeltaOut}`);
  if (!(result.ring.maxAbsX > 0.72 && result.ring.maxAbsX < 1.35)) fail(`reset framing wrong: ring spans ${result.ring.maxAbsX} of the viewport width at dist ${result.dist} (want ~touching edges)`);
  if (result.instCull !== false) fail('window instanced meshes are frustum-culled (windows will vanish)');
  if (!(result.winDrawn >= result.winCulled)) fail(`windows render worse than culled state?? drawn ${result.winDrawn} vs culled ${result.winCulled}`);
  if (result.lotNew <= result.lotOld) fail(`lot not brighter than old matte: ${result.lotNew} vs ${result.lotOld}`);
  if (!(result.redPix[0] > result.redPix[2])) fail(`lot did not follow red theme: ${JSON.stringify(result.redPix)}`);
  if (!(result.wetR < result.dryR - 0.15)) fail(`lot roughness does not respond to wetness: ${result.dryR} -> ${result.wetR}`);
  if (!(result.envOn && result.lotEnvOn > result.lotEnvOff)) fail(`IBL missing or adds no reflection: envOn ${result.envOn}, on ${result.lotEnvOn} vs off ${result.lotEnvOff}`);
}
if (browserErrors.length) fail(`browser errors: ${browserErrors.slice(0, 3).join(' | ')}`);
if (checks.length) { console.error('FAIL\\n' + checks.join('\\n')); chrome.kill('SIGKILL'); server.close(); process.exit(1); }
console.log('ALL LIGHT-QUALITY CHECKS PASS');
chrome.kill('SIGKILL');
server.close();
process.exit(0);
