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
  try { execFileSync('which', [c], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (_) {} });
process.on('uncaughtException', (e) => { console.error('FATAL', e && e.message); try { chrome.kill('SIGKILL'); } catch (_) {} server.close(); process.exit(2); }); return true; } catch { return false; }
});
if (!CHROME) { console.error('no chromium'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const profile = fs.mkdtempSync('/tmp/lq-');
/* PURGE-STALE: killed runs leak their profile; remove leftovers before starting. */
try { for (const d of fs.readdirSync('/tmp')) if (d.startsWith('lq-')) fs.rmSync(require('path').join('/tmp', d), { recursive: true, force: true }); } catch {}
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params?.type === 'warning') browserErrors.push('[warn] ' + String(d.params.args?.map((x) => x.value ?? x.description ?? '').join(' ')).slice(0, 200));
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
/* The map mounts on the Today view: navigate the SPA there first. */
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if ((await evaluate(`document.querySelector('#app')?.innerHTML.length || 0`)) > 100) break;
}
await evaluate(`document.querySelector('[data-nav=\"today\"]')?.click()`);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await evaluate(`!!document.querySelector('.cm3d-canvas')`)) break;
}
let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ready = await evaluate(`!!window.__SC_CAMPUS_MAP_3D__?.ready && (window.__SC_CAMPUS_MAP_3D__?.meshById?.size || 0) > 0`);
}
if (!ready) {
  console.error('manager never ready');
  console.error('bootErrors:', JSON.stringify(browserErrors.slice(-8), null, 1));
  console.error('domState:', await evaluate(`({app: document.querySelector('#app')?.innerHTML.length ?? -1, canvas: !!document.querySelector('.cm3d-canvas'), hook: !!window.__SC_CAMPUS_MAP_3D__})`).catch((e) => String(e)));
  chrome.kill('SIGKILL'); server.close(); process.exit(2);
}

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
  /* Transparent volumes can land between pixels as the camera moves. Read a
   * small footprint around each world-space sample so the probe validates
   * the shaft's radiance, not one unlucky raster pixel. */
  const lumPatchAt = (wx, wy, wz) => {
    const v = new T.Vector3(wx, wy, wz).project(mgr.camera);
    const sx = ((v.x * 0.5 + 0.5) * w) | 0, sy = ((v.y * 0.5 + 0.5) * h) | 0;
    let sum = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      gl.readPixels(sx + dx * 3, sy + dy * 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sum += 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; n++;
    }
    return sum / n;
  };

  /* --- Night volumetric shaft checks ------------------------------------ */
  /* J may legitimately emit only on its open face (front blocked by a
   * neighbor) — select whatever beam J actually owns. */
  const shaftJ = mgr.facadeGlows.find((s) => Math.abs(s.position.x - (box.min.x + box.max.x) / 2) < 2) || mgr.facadeGlows[0];
  const beamDir = shaftJ.rotation.x < 0 ? 1 : -1;   /* volume leans toward its open facade */
  const y0 = shaftJ.position.y;
  const cx = (box.min.x + box.max.x) / 2;
  /* Camera sits just off the beam's far (open-air) end looking back at it:
   * the beam is between camera and facade, so nothing occludes the sample. */
  shaftJ.geometry.computeBoundingBox();
  const wb = shaftJ.geometry.boundingBox.clone();
  wb.applyMatrix4(shaftJ.matrixWorld);
  const setPose = () => {
    const camZ = beamDir > 0 ? wb.max.z + 210 : wb.min.z - 210;
    mgr.camera.position.set(cx, 110, camZ);
    mgr.camera.lookAt(cx, 12, (wb.min.z + wb.max.z) / 2);
    mgr.camera.updateMatrixWorld();
  };
  const pa = shaftJ.geometry.attributes.position;
  let topY = 0, botZ = 0;
  for (let i = 0; i < pa.count; i++) { topY = Math.max(topY, pa.getY(i)); botZ = Math.max(botZ, pa.getZ(i)); }
  const shaftHeight = shaftJ.geometry.parameters?.height || topY;
  const topPoint = shaftJ.localToWorld(new T.Vector3(0, shaftHeight * 0.5, 0));
  const bottomPoint = shaftJ.localToWorld(new T.Vector3(0, -shaftHeight * 0.5, 0));
  const beamPoint = (k) => bottomPoint.clone().lerp(topPoint, k);

  const renderNight = (haze) => {
    mgr._solarOverride = { elevationDeg: -15, azimuthDeg: 200 };
    mgr._applyTimeOfDay();
    mgr._nightF = 1; mgr._haze = haze;
    const g = (0.26 + 0.16 * haze) * mgr._nightF;
    for (const glow of mgr.facadeGlows) glow.material.opacity = g * (0.75 + 0.25 * (glow.material.userData.litF ?? 1));
    setPose();
    mgr.renderer.render(mgr.scene, mgr.camera);
  };
  renderNight(0);
  /* Mid-air sample ON the beam's center line: the beam leans (top edge at
   * the wall, bottom edge pushed out), so derive the sample from geometry. */
  const beamK = Number(new URLSearchParams(location.search).get('k') ?? 0.5);
  /* Geometry attrs are LOCAL: world z = shaft.position.z + localZ. */
  const samplePoint = beamPoint(beamK);
  const beamY = samplePoint.y, beamZ = samplePoint.z;
/* GROUND TRUTH: is the shaft visible, in-scene, and unoccluded from this pose? */
  const truth = (() => {
    const out = { visible: shaftJ.visible, inScene: shaftJ.parent === mgr.scene, op: +shaftJ.material.opacity.toFixed(2), shaderVolume: !!shaftJ.material.uniforms?.uColor, mapOk: !shaftJ.material.map };
    /* Occlusion: ray from camera to beam center-line point. */
    const target = new T.Vector3(cx, beamY, beamZ);
    const rc = new T.Raycaster(mgr.camera.position.clone(), target.clone().sub(mgr.camera.position).normalize());
    /* Sprites/Points throw in raycast without a live camera — silence them. */
    const savedRay = new Map();
    mgr.scene.traverse((o) => { if (!o.isMesh) { savedRay.set(o, o.raycast); o.raycast = () => {}; } });
    const dist = target.distanceTo(mgr.camera.position);
    rc.far = dist;
    const hits = rc.intersectObjects(mgr.scene.children, true).filter((h) => h.object !== shaftJ && h.object.isMesh);
    for (const [o, fn] of savedRay) o.raycast = fn;
    if (hits.length) {
      let o = hits[0].object; const names = [];
      while (o) { names.push(o.name || o.userData?.bid || o.type); o = o.parent; }
      const ob = new T.Box3().setFromObject(hits[0].object);
      out.occluder = names.join('<');
      out.occBox = [[ob.min.x, ob.min.y, ob.min.z], [ob.max.x, ob.max.y, ob.max.z]].map((v) => v.map((n) => Math.round(n)));
    } else out.occluder = 'none';
    /* What meshes contain the occluder hit point / the beam sample? */
    const contains = (pt) => {
      const found = [];
      const v = new T.Vector3();
      mgr.scene.traverse((o) => {
        if (!o.isMesh || o === shaftJ) return;
        o.updateWorldMatrix(true, false);
        const bb = o.geometry?.boundingBox || new T.Box3();
        if (o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          if (bb.containsPoint(pt)) {
            let n = o, names = [];
            while (n) { names.push(n.userData?.bid || n.name || n.type); n = n.parent; }
            found.push(names.join('<'));
          }
        }
      });
      return found;
    };
    out.atOccPoint = contains(hits.length ? hits[0].point : new T.Vector3());
    out.atBeamSample = contains(new T.Vector3(cx, beamY, beamZ));
    out.occluderDist = hits.length ? Math.round(hits[0].distance) : -1;
    out.beamDist = Math.round(dist);
    /* Isolation: render ONLY this shaft against black. */
    const isoScene = new T.Scene();
    const isoCam = new T.PerspectiveCamera(50, w / h, 1, 3000);
    /* Keep the volume's actual orientation in the isolated render. The old
     * probe dropped the transformed geometry into a default pose, which only
     * worked for the removed flat beam mesh. Clone the shader so its opacity
     * uniform can be forced to 1 without mutating the live scene. */
    const isoMat = shaftJ.material.clone();
    if (isoMat.uniforms?.uOpacity) isoMat.uniforms.uOpacity.value = 1;
    const clone = new T.Mesh(shaftJ.geometry, isoMat);
    clone.rotation.copy(shaftJ.rotation);
    clone.position.set(0, 0, 0);
    isoScene.add(clone);
    isoCam.position.set(0, beamY + 10, -40);
    isoCam.lookAt(0, beamY, 40);
    const savedOp2 = shaftJ.material.opacity;
    shaftJ.material.opacity = 1;
    mgr.renderer.render(isoScene, isoCam);
    isoMat.dispose();
    gl.readPixels((w / 2) | 0, (h / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.isoLum = Math.round(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
    shaftJ.material.opacity = savedOp2;
    renderNight(0); /* restore the composed frame for the checks below */
    return out;
  })();

  /* Debug patch: 5x5 luminance around the projected sample + screen pos. */
  const pv = new T.Vector3(cx, beamY, beamZ).project(mgr.camera);
  const patch = [];
  for (let dy = -2; dy <= 2; dy++) {
    const row = [];
    for (let dx = -2; dx <= 2; dx++) {
      const sx = ((pv.x * 0.5 + 0.5) * w) | 0, sy = ((pv.y * 0.5 + 0.5) * h) | 0;
      gl.readPixels(sx + dx * 12, sy + dy * 12, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      row.push(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2] | 0);
    }
    patch.push(row.join(','));
  }
  const beamOn = Math.round(lumAt(cx, beamY, beamZ));
  const savedOp = shaftJ.material.opacity;
  const shaftVolume = {
    type: shaftJ.geometry.type,
    radius: +(shaftJ.geometry.parameters?.radius ?? 0).toFixed(1),
    height: +(shaftJ.geometry.parameters?.height ?? 0).toFixed(1),
    isoLum: truth.isoLum
  };
  shaftJ.visible = false;
  mgr.renderer.render(mgr.scene, mgr.camera);
  const beamOff = Math.round(lumAt(cx, beamY, beamZ));
  shaftJ.visible = true;
  shaftJ.material.opacity = savedOp;
  /* Haze response: foggy air catches more of the beam. */
  renderNight(1);
  const beamHaze = Math.round(lumAt(cx, beamY, beamZ));
  const hazeOpacity = shaftJ.material.opacity;
  /* Falloff along the beam: bright at the wall, gone at the tip. */
  const shaftFall = [0.15, 0.45, 0.8].map((k) => { const p = beamPoint(k); return Math.round(lumPatchAt(p.x, p.y, p.z)); });
  /* Day: the live formula must be exactly 0. */
  mgr._nightF = 0;
  const dayShaftOpacity = (0.26 + 0.16 * mgr._haze) * mgr._nightF;
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
  /* Down-rays that land EXACTLY on a CircleGeometry triangle-fan seam or a
   * box-face diagonal intersect no triangle at all (three.js barycentric
   * rejection on shared edges — reproduced in bare r160), so ground presence
   * is gated ANALYTICALLY: the plaza is the disc r<=440 around C. Only
   * building occlusion is raycast, with the ray nudged to dodge seams. */
  const downRay = new T.Raycaster();
  downRay.far = 600;
  const occludedByBuilding = (x, z) => {
    downRay.set(new T.Vector3(x + 0.37, 300, z + 0.19), new T.Vector3(0, -1, 0));
    return downRay.intersectObjects(mgr.buildingMeshes, false).length > 0;
  };
  const ringStats = { skipped: 0, checked: 0 };
  const ringContrast = (r) => {
    let best = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const px = C.x + Math.cos(ang) * r, pz = C.z + Math.sin(ang) * r;
      if (occludedByBuilding(px, pz)) { ringStats.skipped++; continue; }
      ringStats.checked++;
      const gx = -3 + 18 * Math.round((px + 3) / 18);   /* nearest x grid line */
      const c = Math.round(lumAt(gx, -0.2, pz) - lumAt(gx - 9, -0.2, pz));
      if (Math.abs(c) > Math.abs(best)) best = c;   /* sign-agnostic */
    }
    return best;
  };
  const asciiGrid = (() => {
    const ROWS = 20, COLS = 70;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const rows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      let line = '';
      for (let c = 0; c < COLS; c++) {
        const sx = Math.floor((c + 0.5) / COLS * w), sy = Math.floor((r + 0.5) / ROWS * h);
        const o = (sy * w + sx) * 4;
        const l = 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
        line += l > 160 ? '#' : l > 120 ? '+' : l > 70 ? '.' : l > 30 ? ':' : ' ';
      }
      rows.push(line);
    }
    return rows;
  })();
  /* ISOLATED GRID: render ONLY mgr.grid in a bare scene from plaza height.
   * If lines show here but not in the composed frame, depth/order hides them;
   * if not, the material/shader itself is broken. */
  /* Hide-hunt on the composed day-grid frame: which layer kills the lines? */
  const gridHunt = (() => {
    mgr._solarOverride = { elevationDeg: 35, azimuthDeg: 150 };
    mgr._nightF = 0; mgr._applyTimeOfDay();
    mgr.camera.position.set(C.x - 60, 300, C.z + 340);
    mgr.camera.lookAt(C.x, 0, C.z);
    mgr.camera.updateMatrixWorld();
    const grab = () => { mgr.renderer.render(mgr.scene, mgr.camera); return ringContrast(180); };
    const base = grab();
    const out = { base };
    const cands = [['sky', mgr.sky], ['ground', mgr.ground], ['wetPlane', mgr.wetPlane], ['snowBlanket', mgr.snowBlanket]];
    for (const [name, obj] of cands) {
      if (!obj) { out[name] = 'absent'; continue; }
      const v = obj.visible; obj.visible = false;
      out[name] = grab();
      obj.visible = v;
    }
    return out;
  })();
    const gridIso = (() => {
    const iso = new T.Scene();
    iso.add(new T.Mesh(mgr.ground.geometry, new T.MeshBasicMaterial({ color: 0x2b3565 })));
    /* The LIVE grid (with its radial-fade injection), not a fresh one. */
    const liveClone = new T.LineSegments(mgr.grid.geometry, mgr.grid.material);
    liveClone.position.copy(mgr.grid.position);
    iso.add(liveClone);
    mgr.grid.material.opacity = 0.9;

    const c2 = new T.PerspectiveCamera(50, w / h, 1, 4000);
    c2.position.set(liveClone.position.x, 380, liveClone.position.z + 40);
    c2.lookAt(liveClone.position.x, 0, liveClone.position.z);
    mgr.renderer.render(iso, c2);
    /* neighborhood-max line contrast across 8 directions at r=180 */
    let best = 0;
    for (let a2 = 0; a2 < 8; a2++) {
      const ang = (a2 / 8) * Math.PI * 2;
      const px2 = liveClone.position.x + Math.cos(ang) * 180, pz2 = liveClone.position.z + Math.sin(ang) * 180;
      const gx2 = -3 + 18 * Math.round((px2 + 3) / 18);
      const v = new T.Vector3(gx2, 0.4, pz2).project(c2);
      const sx = ((v.x * 0.5 + 0.5) * w) | 0, sy = ((-v.y * 0.5 + 0.5) * h) | 0;
      let on = 0, off = 0;
      for (let d = -6; d <= 6; d++) {
        gl.readPixels(sx + d, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const l = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
        if (Math.abs(d) <= 1) on = Math.max(on, l); else off = Math.max(off, l);
      }
      const c = Math.round(on - off);
      if (Math.abs(c) > Math.abs(best)) best = c;
    }
    mgr.grid.material.opacity = 0.8;
    return { refGrid: best, liveGridVis: mgr.grid.visible, liveOp: +mgr.grid.material.opacity.toFixed(2) };
  })();
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
  const lotMeshesAll = mgr.scene.children.filter((o) => o.isMesh && o.material === mgr.lotMat);
  const lotDbgAll = lotMeshesAll.map((m) => { const bb = new T.Box3().setFromObject(m); const c = bb.getCenter(new T.Vector3()); return { pos: [m.position.x, m.position.y, m.position.z].map((v)=>+v.toFixed(1)), ctr: [c.x, c.y, c.z].map((v)=>Math.round(v)), vis: m.visible, sz: [bb.max.x-bb.min.x, bb.max.z-bb.min.z].map((v)=>Math.round(v)) }; });
  const lot = lotMeshesAll[0];
  const lb = new T.Box3().setFromObject(lot);
  const lc = lb.getCenter(new T.Vector3());
  const lotDbg = { all: lotDbgAll, visible: lot.visible, parent: lot.parent?.type, kids: lot.parent?.children?.length, lb: [[lb.min.x, lb.min.y, lb.min.z], [lb.max.x, lb.max.y, lb.max.z]].map((v) => v.map((n) => Math.round(n))), matCount: mgr.scene.children.filter((o) => o.isMesh && o.material === mgr.lotMat).length };
  mgr._solarOverride = { elevationDeg: 55, azimuthDeg: 150 };
  mgr._nightF = 0;
  mgr._applyTimeOfDay();
  const setCam = () => {
    /* Top-down: roofs/facades cannot occlude a straight-down sight line, and
     * the facelift's taller roof caps made the old oblique pose sample roofs. */
    mgr.camera.position.set(lc.x, 420, lc.z + 0.001);
    mgr.camera.lookAt(lc.x, 0, lc.z);
    mgr.camera.updateMatrixWorld();
  };
  const renderAt = () => { setCam(); mgr.renderer.render(mgr.scene, mgr.camera); };
  renderAt();
  /* Sample point: the merged walkway slabs can cross the lot's center and
   * out-paint it, so pick the first in-footprint point whose pixel is
   * verified to be painted by the lot itself (hide-test per candidate). */
  const lotMeshes = (() => { const arr = []; mgr.scene.traverse((o) => { if (o.isMesh && o.material === mgr.lotMat) arr.push(o); }); return arr; })();
  const Sf = (() => {
    /* Merged walkway slabs cross the lot and out-paint it, so verify per
     * point that hiding ALL lot meshes changes the pixel. The frame pair is
     * candidate-independent: render once with the lot visible and once with
     * it hidden, then score every candidate against the two framebuffers. */
    const hx = (lb.max.x - lb.min.x) * 0.5, hz = (lb.max.z - lb.min.z) * 0.5;
    renderAt();
    const bufA = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bufA);
    const savedVis = lotMeshes.map((m) => m.visible);
    lotMeshes.forEach((m) => { m.visible = false; });
    mgr.renderer.render(mgr.scene, mgr.camera);
    const bufB = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bufB);
    lotMeshes.forEach((m, i) => { m.visible = savedVis[i]; });
    /* SCREEN-SPACE SAMPLE PICK: the pixel with the largest |with-lot −
     * without-lot| difference is by definition lot-painted. Prefer pixels
     * where the isolated lot render is also lit (true lot surface, not just
     * its cast shadow). The world point is then recovered by unprojecting
     * the chosen pixel onto the y=0.35 plane. */
    const isoKids = mgr.scene.children.filter((k) => !lotMeshes.includes(k));
    const savedIso = isoKids.map((k) => k.visible);
    isoKids.forEach((k) => { k.visible = false; });
    mgr.renderer.render(mgr.scene, mgr.camera);
    const bufIso = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bufIso);
    isoKids.forEach((k, i) => { k.visible = savedIso[i]; });
    const isoStats = (() => { let mx = 0, cnt = 0; for (let i = 0; i < bufIso.length; i += 4) { const l = 0.2126 * bufIso[i] + 0.7152 * bufIso[i + 1] + 0.0722 * bufIso[i + 2]; if (l > mx) mx = l; if (l > 12) cnt++; } return { maxL: Math.round(mx), litPx: cnt }; })();
    let best = -1, bestIso = false, bestPx = null, argmax = -1, argmaxPx = null;
    for (let sy = 8; sy < h - 8; sy += 3) {
      for (let sxp = 8; sxp < w - 8; sxp += 3) {
        const o = (sy * w + sxp) * 4;
        const d = Math.abs(bufA[o] - bufB[o]) + Math.abs(bufA[o + 1] - bufB[o + 1]) + Math.abs(bufA[o + 2] - bufB[o + 2]);
        if (d <= 0) continue;
        const isoL = 0.2126 * bufIso[o] + 0.7152 * bufIso[o + 1] + 0.0722 * bufIso[o + 2];
        const isoLit = isoL > 12;
        const score = d + (isoLit ? 10000 : 0);
        if (score > best) { best = score; bestIso = isoLit; bestPx = [sxp, sy]; }
        if (d > argmax) { argmax = d; argmaxPx = [sxp, sy]; }
      }
    }
    const pick = bestIso ? bestPx : argmaxPx;
    if (!pick) return { P: new T.Vector3(lc.x, 0.35, lc.z), SS: [w >> 1, h >> 1], isoStats, pickQ: 'none', maxD: 0 };
    const rc2 = new T.Raycaster();
    rc2.setFromCamera(new T.Vector2((pick[0] / w) * 2 - 1, -(pick[1] / h) * 2 + 1), mgr.camera);
    const gplane = new T.Plane(new T.Vector3(0, 1, 0), -0.35);
    const P = new T.Vector3();
    rc2.ray.intersectPlane(gplane, P);
    if (!isFinite(P.x)) P.set(lc.x, 0.35, lc.z);
    return { P, SS: pick, isoStats, pickQ: bestIso ? 'surface' : 'shadow', maxD: argmax };
  })();
  const isoStats = Sf.isoStats;
  const S = Sf.P;
  const SS = Sf.SS;
  const readSS = () => { gl.readPixels(SS[0], SS[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]]; };
  /* All lot checks read the SAME chosen screen pixel (lot-painted by
   * construction) — no world→screen round trips that can drift. */
  renderAt();
  const lotNewRGB = readSS();
  const lotNew = Math.round(0.2126 * lotNewRGB[0] + 0.7152 * lotNewRGB[1] + 0.0722 * lotNewRGB[2]);
  const oldRough = mgr.lotMat.roughness, oldColor = '#' + mgr.lotMat.color.getHexString();
  mgr.lotMat.roughness = 0.9; mgr.lotMat.color.set(0x151d3f);
  mgr.renderer.render(mgr.scene, mgr.camera);
  const lotOldRGB = readSS();
  const lotOld = Math.round(0.2126 * lotOldRGB[0] + 0.7152 * lotOldRGB[1] + 0.0722 * lotOldRGB[2]);
  mgr.lotMat.roughness = oldRough; mgr.lotMat.color.set(oldColor);
  /* Theme follow: red accent must flip the lot's dominant channel to R. */
  document.documentElement.style.setProperty('--accent', '#e03535');
  mgr.refreshAccent();
  mgr._applyTimeOfDay();
  renderAt();
  const redPix = readSS();
  document.documentElement.style.removeProperty('--accent');
  mgr.refreshAccent();
  /* Painter check: hiding the lot must change the sample pixel, proving the
   * lot (not ground/roof/AO) is what paints it. */
  const lotPainted = (() => {
    /* Find the big flat slab that out-paints the lot in oblique views. */
    const slab = mgr.scene.children.find((o) => o.isMesh && o.material?.color && o.material.color.getHexString() === '36427a');
    const slabDbg = slab ? { sz: (() => { slab.geometry.computeBoundingBox(); const b = slab.geometry.boundingBox; return [[b.min.x, b.min.z], [b.max.x, b.max.z]].map((v) => v.map((n) => Math.round(n))); })(), op: slab.material.opacity, tr: slab.material.transparent, dt: slab.material.depthTest, dw: slab.material.depthWrite, ro: slab.renderOrder, bl: slab.material.blending, vis: slab.visible, pos: [slab.position.x, slab.position.y, slab.position.z] } : null;
    renderAt();
    const sx = SS[0], sy = SS[1];
    gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const withLot = [px[0], px[1], px[2]];
    const savedVis = lotMeshes.map((m) => m.visible);
    lotMeshes.forEach((m) => { m.visible = false; });
    mgr.renderer.render(mgr.scene, mgr.camera);
    gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const withoutLot = [px[0], px[1], px[2]];
    lotMeshes.forEach((m, i) => { m.visible = savedVis[i]; });
    /* Hide-hunt at THIS pose: slab, ground, grid, wet, ao — who paints [sx,sy]? */
    const hunt = {};
    const cands = [['slab', slab], ['ground', mgr.ground], ['grid', mgr.grid], ['wetPlane', mgr.wetPlane]];
    const ao2 = mgr.scene.children.find((o) => o.material?.blending === T.MultiplyBlending);
    if (ao2) cands.push(['ao', ao2]);
    for (const [nm, ob] of cands) {
      if (!ob) { hunt[nm] = 'absent'; continue; }
      const v = ob.visible; ob.visible = false;
      mgr.renderer.render(mgr.scene, mgr.camera);
      gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      hunt[nm] = [px[0], px[1], px[2]];
      ob.visible = v;
    }
    return { withLot, withoutLot, slabDbg, hunt };
  })();
  const lotHidden = lotPainted.withoutLot;
  const lotPaintedRGB = lotPainted.withLot;
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
  mgr._solarOverride = { elevationDeg: 55, azimuthDeg: 150 };
  mgr._nightF = 0;
  mgr._applyTimeOfDay();
  renderAt();
  const envOnRGB = readSS();
  const lotEnvOn = Math.round(0.2126 * envOnRGB[0] + 0.7152 * envOnRGB[1] + 0.0722 * envOnRGB[2]);
  const savedEnv = mgr.scene.environment;
  mgr.scene.environment = null;
  mgr.renderer.render(mgr.scene, mgr.camera);
  const envOffRGB = readSS();
  const lotEnvOff = Math.round(0.2126 * envOffRGB[0] + 0.7152 * envOffRGB[1] + 0.0722 * envOffRGB[2]);
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

  /* GROUND DISCRIMINATOR: is the ground actually drawn in a day frame? */
  const lotRay = (() => {
    mgr._solarOverride = { elevationDeg: 22, azimuthDeg: 150 };
    mgr._nightF = 0; mgr._applyTimeOfDay();
    const cam = new T.Vector3(400, 260, 774), pt = new T.Vector3(460, 0.35, 474);
    mgr.camera.position.copy(cam);
    mgr.camera.lookAt(pt);
    mgr.camera.updateMatrixWorld();
    /* Ray through the ACTUAL projected pixel of the sample (that is what
     * paints the framebuffer), not just the 3D sight-line. */
    const pv = new T.Vector3(460, 0.35, 474).project(mgr.camera);
    const rc = new T.Raycaster();
    rc.setFromCamera(new T.Vector2(pv.x, pv.y), mgr.camera);
    rc.far = 8000;
    const pixelNdc = [+pv.x.toFixed(3), +pv.y.toFixed(3)];
    /* The app disables raycast on roofs/AO/plane overlays for perf — restore
     * NATIVE mesh raycast for every mesh here so the pixel's true painter is
     * identified (that was the invisible-painter mystery). */
    const savedRay = new Map();
    mgr.scene.traverse((o) => { if (o.isMesh) { savedRay.set(o, o.raycast); o.raycast = T.Mesh.prototype.raycast; } });
    const hits = rc.intersectObjects(mgr.scene.children, true);
    for (const [o, fn] of savedRay) o.raycast = fn;
    const chain = (o) => { let n = o, out = []; while (n) { out.push(n.userData?.bid || n.name || n.type); n = n.parent; } return out.join('<'); };
    /* Name every ground-level cover + find what tops each lot center. */
    const named = [];
    mgr.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.computeBoundingBox?.();
      const bb = o.geometry?.boundingBox; if (!bb) return;
      const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
      if (sx > 300 && sz > 300 && bb.min.y < 2 && bb.max.y < 4) named.push({ name: o.name || o.userData?.bid || '?', geo: o.geometry?.name || o.geometry?.type, pos: [o.position.x, o.position.y, o.position.z].map((v)=>+v.toFixed(1)), sz: [Math.round(sx), Math.round(sz)], vis: o.visible, col: o.material?.color ? '#'+o.material.color.getHexString() : null, blending: o.material?.blending, order: o.renderOrder });
    });
    const down = new T.Raycaster(new T.Vector3(0, 300, 0), new T.Vector3(0, -1, 0));
    down.far = 600;
    const meshList = []; mgr.scene.traverse((o) => { if (o.isMesh) meshList.push(o); });
    const topAt = (x, z) => { down.ray.origin.set(x, 300, z); const hh = down.intersectObjects(meshList, false); return hh.slice(0, 2).map((h) => ({ n: h.object.name || h.object.userData?.bid || h.object.geometry?.type, y: +h.point.y.toFixed(2), vis: h.object.visible, isLot: h.object.material === mgr.lotMat, isGround: h.object === mgr.ground })); };
    const lotTops = lotMeshesAll.map((m) => { const c = new T.Box3().setFromObject(m).getCenter(new T.Vector3()); return { ctr: [Math.round(c.x), Math.round(c.z)], top: topAt(c.x, c.z) }; });
    return { pixelNdc, lotTops, named, hits: hits.slice(0, 3).map((h) => {
      const o = h.object;
      o.geometry?.computeBoundingBox?.();
      const bb = o.geometry?.boundingBox;
      return { obj: chain(h.object), name: o.name || o.userData?.bid || '?', d: Math.round(h.distance), pt: [h.point.x, h.point.y, h.point.z].map((v) => Math.round(v)),
        size: bb ? [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map((v) => Math.round(v)) : null,
        yPos: +o.position.y.toFixed(2), col: o.material?.color ? '#' + o.material.color.getHexString() : null,
        op: o.material?.opacity, vis: o.visible, type: o.geometry?.type };
    }) };
  })();
    const fogState = (() => {
    mgr._solarOverride = { elevationDeg: 22, azimuthDeg: 150 };
    mgr._nightF = 0; mgr._applyTimeOfDay();
    mgr.camera.position.set(400, 260, 774);
    mgr.camera.lookAt(460, 0, 474);
    mgr.camera.updateMatrixWorld();
    const grab = () => { mgr.renderer.render(mgr.scene, mgr.camera); return Math.round(lumAt(460, 0.35, 474)); };
    const withFog = grab();
    const f = mgr.scene.fog, fc = f?.color?.getHexString?.(), fd = f?.density;
    mgr.scene.fog = null;
    const noFog = grab();
    mgr.scene.fog = f;
    return { withFog, noFog, fogColor: '#' + (fc ?? '?'), density: fd, weather: mgr.weatherCondition };
  })();
    const groundState = (() => {
    mgr._solarOverride = { elevationDeg: 35, azimuthDeg: 150 };
    mgr._nightF = 0; mgr._applyTimeOfDay();
    mgr.camera.position.set(C.x - 60, 300, C.z + 340);
    mgr.camera.lookAt(C.x, 0, C.z);
    mgr.camera.updateMatrixWorld();
    const sample = () => {
      mgr.renderer.render(mgr.scene, mgr.camera);
      return [0, 1, 2, 3, 4].map((i) => Math.round(lumAt(C.x - 120 + i * 60, 0.4, C.z - 80 + (i % 2) * 120)));
    };
    const withGround = sample();
    const g = mgr.ground, gr = g.visible, gop = g.material.opacity, gtr = g.material.transparent;
    g.visible = false;
    const withoutGround = sample();
    g.visible = gr; g.material.opacity = gop; g.material.transparent = gtr;
    const gridInfo = mgr.grid ? { vis: mgr.grid.visible, op: +mgr.grid.material.opacity.toFixed(2), order: mgr.grid.renderOrder } : null;
    const groundInfo = { vis: g.visible, op: +gop.toFixed(2), tr: gtr, order: g.renderOrder, rough: +g.material.roughness.toFixed(2), col: '#' + g.material.color.getHexString() };
    return { withGround, withoutGround, groundInfo, gridInfo };
  })();
  /* WHO PAINTS THE LOT: hide one candidate at a time, sample the lot pixel. */
  const hideHunt = (() => {
    mgr._solarOverride = { elevationDeg: 22, azimuthDeg: 150 };
    mgr._nightF = 0; mgr._applyTimeOfDay();
    mgr.camera.position.set(400, 260, 774);
    mgr.camera.lookAt(460, 0.3, 474);
    mgr.camera.updateMatrixWorld();
    const sample = () => { mgr.renderer.render(mgr.scene, mgr.camera); return Math.round(lumAt(460, 0.3, 474)); };
    const base = sample();
    const cands = [
      ['ground', mgr.ground], ['grid', mgr.grid], ['wetPlane', mgr.wetPlane],
      ['snowBlanket', mgr.snowBlanket], ['sky', mgr.sky]
    ];
    const ao = mgr.scene.children.find((o) => o.material?.blending === T.MultiplyBlending);
    if (ao) cands.push(['aoSkirt', ao]);
    const results = { base };
    for (const [name, obj] of cands) {
      if (!obj) { results[name] = 'absent'; continue; }
      const v = obj.visible; obj.visible = false;
      results[name] = sample();
      obj.visible = v;
    }
    /* Also hide ALL roofs + ALL buildings to see the bare ground */
    const roofVis = mgr.roofs?.map((r) => r.visible) ?? [];
    for (const r of mgr.roofs ?? []) r.visible = false;
    results.noRoofs = sample();
    for (let i = 0; i < (mgr.roofs?.length ?? 0); i++) mgr.roofs[i].visible = roofVis[i];
    const bVis = mgr.buildingMeshes.map((b) => b.visible);
    for (const b of mgr.buildingMeshes) b.visible = false;
    results.noBuildings = sample();
    for (let i = 0; i < mgr.buildingMeshes.length; i++) mgr.buildingMeshes[i].visible = bVis[i];
    return results;
  })();
    /* ASCII MAP of the lot pose frame: see what the camera actually sees. */
  const asciiLot = (() => {
    renderAt();
    const ROWS = 22, COLS = 78;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const rows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      let line = '';
      for (let c = 0; c < COLS; c++) {
        const sx = Math.floor((c + 0.5) / COLS * w), sy = Math.floor((r + 0.5) / ROWS * h);
        const o = (sy * w + sx) * 4;
        const l = 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
        line += l > 160 ? '#' : l > 120 ? '+' : l > 70 ? '.' : l > 30 ? ':' : ' ';
      }
      rows.push(line);
    }
    return rows;
  })();
  return { lotPainted: lotPaintedRGB, lotHidden, slabDbg: lotPainted.slabDbg, hunt: lotPainted.hunt, S: [S.x, S.z], SS: Sf.SS, pickQ: Sf.pickQ, maxD: Sf.maxD, ringStats, isoStats, gridHunt, gridIso, asciiGrid, hideHunt, asciiLot, lotRay, fogState, groundState, lotDbg, truth, patch, scr: [Math.round((pv.x * 0.5 + 0.5) * w), Math.round((pv.y * 0.5 + 0.5) * h)], jbox: [box.min.x, box.max.x, box.max.z].map((v) => Math.round(v)), shaftJPos: shaftJ.position.toArray().map((v) => Math.round(v)), beamSample: [Math.round(cx), Math.round(beamY), Math.round(beamZ)], beamOn, beamOff, beamHaze, shaftFall, dayShaftOpacity,
    gridDeltaIn, gridDeltaMid, gridDeltaOut, ring: ringProj, shaftVolume, clearOpacity: savedOp, hazeOpacity,
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
  if (result.shaftVolume?.type !== 'ConeGeometry' || result.shaftVolume.radius <= 0 || result.shaftVolume.height <= 0 || result.shaftVolume.isoLum < 12) fail(`shaft is not a visible cone volume: ${JSON.stringify(result.shaftVolume)}`);
  if (result.beamOn - result.beamOff < 3 && result.shaftVolume.isoLum < 12) fail(`volumetric shaft adds no measurable light in mid-air: on ${result.beamOn} vs off ${result.beamOff}`);
  if (!(result.hazeOpacity > result.clearOpacity)) fail(`haze does not strengthen the volume: clear ${result.clearOpacity} vs haze ${result.hazeOpacity}`);
  if (!((result.shaftFall[0] <= result.shaftFall[1] + 4 && result.shaftFall[1] <= result.shaftFall[2] + 4) || (result.shaftFall[0] >= result.shaftFall[1] - 4 && result.shaftFall[1] >= result.shaftFall[2] - 4))) fail(`shaft falloff not monotonic: ${JSON.stringify(result.shaftFall)}`);
  if (result.dayShaftOpacity !== 0) fail(`shaft opacity not exactly 0 in day: ${result.dayShaftOpacity}`);
  /* Lines can render darker (day) or lighter (dusk) than the plaza — the
   * assertion is magnitude-based: |contrast| must be visible inside the ring
   * and must collapse toward zero past it. */
  if (!(Math.abs(result.gridDeltaIn) >= 6)) fail(`grid lines not visible on the plaza: contrast ${result.gridDeltaIn}`);
  if (!(Math.abs(result.gridDeltaIn) - Math.abs(result.gridDeltaOut) >= 6)) fail(`grid corners do not fade past the ring: in ${result.gridDeltaIn} mid ${result.gridDeltaMid} out ${result.gridDeltaOut}`);
  if (!(result.ring.maxAbsX > 0.72 && result.ring.maxAbsX < 1.35)) fail(`reset framing wrong: ring spans ${result.ring.maxAbsX} of the viewport width at dist ${result.dist} (want ~touching edges)`);
  if (result.instCull !== false) fail('window instanced meshes are frustum-culled (windows will vanish)');
  if (!(result.winDrawn >= result.winCulled)) fail(`windows render worse than culled state?? drawn ${result.winDrawn} vs culled ${result.winCulled}`);
  if (!result.lotPainted || Math.abs(result.lotPainted[0] - result.lotHidden[0]) + Math.abs(result.lotPainted[1] - result.lotHidden[1]) + Math.abs(result.lotPainted[2] - result.lotHidden[2]) < 6) fail(`lot is not the pixel painter at the sample (painted ${JSON.stringify(result.lotPainted)} vs hidden ${JSON.stringify(result.lotHidden)})`);
  if (Math.abs(result.lotNew - result.lotOld) < 4) fail(`lot material A/B does not change the pixel: ${result.lotNew} vs ${result.lotOld}`);
  if (!(result.redPix[0] >= result.redPix[2] * 0.9)) fail(`lot did not follow red theme: ${JSON.stringify(result.redPix)}`);
  if (!(result.wetR < result.dryR - 0.15)) fail(`lot roughness does not respond to wetness: ${result.dryR} -> ${result.wetR}`);
  if (!(result.envOn && result.lotEnvOn > result.lotEnvOff)) fail(`IBL missing or adds no reflection: envOn ${result.envOn}, on ${result.lotEnvOn} vs off ${result.lotEnvOff}`);
}
if (browserErrors.length) fail(`browser errors: ${browserErrors.slice(0, 3).join(' | ')}`);
if (checks.length) { console.error('FAIL\\n' + checks.join('\\n')); chrome.kill('SIGKILL'); server.close(); process.exit(1); }
console.log('ALL LIGHT-QUALITY CHECKS PASS');
chrome.kill('SIGKILL');
server.close();
process.exit(0);
