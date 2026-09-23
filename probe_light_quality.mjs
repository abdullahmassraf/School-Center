/* Light-quality probe for the Davis campus twin.
 *
 * Guards the day/night exposure contract that started this work: the sun has to
 * come up at noon, the night key light has to actually dim (the map used to stay
 * "way too bright" after dark), the weather blend has to reach a raining state,
 * the desktop tier has to keep its far-field DOF path, and a real frame has to be
 * drawn with the packed vehicle assets behind it.
 *
 * The twin blends weather and reads the sun from its own frame loop, so every
 * step here changes state and then WAITS for real frames instead of calling the
 * env update by hand with dt = 0 - reading right after setTime() is what made an
 * earlier version of this probe report zeroes. Steps are separate CDP calls too,
 * so a single slow SwiftShader frame cannot trip the per-call timeout.
 *
 * Usage: node probe_light_quality.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(), PORT = 8983, DEBUG_PORT = 9283;
const CHROME = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']
  .find(c => { try { execFileSync('which', [c], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!CHROME) { console.error('no chromium'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''), file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const profile = fs.mkdtempSync('/tmp/sc-lq-');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-crash-reporter', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--window-size=960,640', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await new Promise(r => setTimeout(r, 250));
}
if (!target) { console.error('no CDP page'); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const pending = new Map(), errors = [];
ws.onmessage = e => {
  const d = JSON.parse(e.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || 'exception');
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console error');
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++seq; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); } }, 40000);
});
const ev = async expression => {
  const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'eval error');
  return d.result.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QA_DIR = path.join(ROOT, 'qa-artifacts'); fs.mkdirSync(QA_DIR, { recursive: true });

/* Frames under SwiftShader take most of a second, and the twin blends weather
 * and stages its vehicle assets across frames, so wall-clock sleeps are not a
 * reliable proxy for progress: wait for the state to arrive instead. */
const waitFor = async (expression, timeout, interval = 400) => {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) { last = await ev(expression); if (last) return last; await sleep(interval); }
  return last;
};
const FRAME_STATS = `(()=>{const d=window.__DAVIS_TWIN_DEBUG__;return{calls:d.renderer.info.render.calls,triangles:d.renderer.info.render.triangles,geometries:d.renderer.info.memory.geometries,children:d.scene.children.length}})()`;

const failures = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${JSON.stringify(detail)}`);
  if (!ok) failures.push(label);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/campus-twin.html?debug=1&quality=high&weather=clear` });

const started = Date.now();
let booted = false;
while (Date.now() - started < 120000 && !booted) {
  booted = await ev(`(()=>{const f=document.querySelector('#fatal');if(f&&!f.hidden)return 'fatal';const l=document.querySelector('#loader');return !!window.__DAVIS_TWIN_DEBUG__&&(!l||l.classList.contains('done'))})()`);
  if (booted === 'fatal') throw new Error('twin fatal: ' + await ev(`document.querySelector('#fatalMsg')?.textContent||''`));
  if (!booted) await sleep(400);
}
if (!booted) throw new Error('twin did not finish booting');

const read = () => ev(`(()=>{const d=window.__DAVIS_TWIN_DEBUG__;return{night:d.ST.night,day:d.ST.day,wet:d.ST.wet,rain:d.W.rain,snow:d.W.snow,cloud:d.W.cloud,sun:d.keyLight.intensity,mobileProfile:d.mobileProfile,tier:d.tierName,pr:d.renderer.getPixelRatio(),dof:d.FX.dof,baseDof:d.baseFX.dof,bloom:d.FX.bloom,calls:d.renderer.info.render.calls,triangles:d.renderer.info.render.triangles,environment:!!d.scene.environment,carAsset:d.ASSET_STATE.car,transitAssets:d.ASSET_STATE.transit,trafficMode:d.traffic&&d.traffic.mode,transitCount:d.transit&&d.transit.vehicles.length}})()`);

/* 1 - the tier this probe describes. `renderer.info` is reset by the composite
 * pass, so a finished frame reports a single fullscreen triangle just like the
 * acceptance suite asserts; scene content is measured from the frame geometry
 * counters instead. */
await waitFor(`(()=>{const d=window.__DAVIS_TWIN_DEBUG__;return d.ASSET_STATE.car!=='pending'&&d.ASSET_STATE.transit.bus!=='pending'&&d.ASSET_STATE.transit.schoolBus!=='pending'})()`, 90000);
const base = await read();
const frame = await ev(FRAME_STATS);
check('desktop high tier', !base.mobileProfile && base.tier === 'high' && base.baseDof > 0 && base.dof > 0, { mobileProfile: base.mobileProfile, tier: base.tier, baseDof: base.baseDof, dof: base.dof });
check('real frame drawn', frame.calls > 0 && frame.geometries > 50 && frame.children > 5, frame);
check('packed assets in scene', base.environment && base.carAsset === 'loaded' && base.transitAssets.bus === 'loaded' && base.transitAssets.schoolBus === 'loaded' && base.trafficMode === 'packed' && base.transitCount === 2, { car: base.carAsset, bus: base.transitAssets.bus, schoolBus: base.transitAssets.schoolBus, mode: base.trafficMode, transit: base.transitCount });

/* 2 - noon: the sun is up. */
await ev(`window.DavisTwin.setTime(Date.parse('2026-06-21T13:00:00-04:00'))`);
await waitFor(`(()=>window.__DAVIS_TWIN_DEBUG__.ST.day>.75)()`, 20000);
const noon = await read();
check('noon is daylight', noon.night <= .25 && noon.day >= .75 && noon.sun > 0, { night: noon.night, day: noon.day, sun: noon.sun });

/* 3 - rain reaches the live weather blend. */
await ev(`window.DavisTwin.setWeather('rain')`);
await waitFor(`(()=>window.__DAVIS_TWIN_DEBUG__.W.rain>.002)()`, 40000);
const wet = await read();
/* The weather blend is a deliberately slow real-time transition (the soaked
 * ground alone takes ~9 s of real frames). SwiftShader renders this scene at
 * roughly one frame per second, so the probe asserts the selected target plus
 * measurable progress toward it rather than the converged value. */
const weatherSelected = await ev(`document.querySelector('#weatherSeg button.on')?.dataset.weather||null`);
check('rain blend engaged', weatherSelected === 'rain' && wet.rain > .002 && wet.rain > base.rain, { selected: weatherSelected, rain: wet.rain, cloud: wet.cloud, wet: wet.wet });

/* 4 - winter night: dark enough, but still lit. */
await ev(`window.DavisTwin.setTime(Date.parse('2026-12-21T21:30:00-05:00'))`);
await waitFor(`(()=>window.__DAVIS_TWIN_DEBUG__.ST.night>.6)()`, 20000);
const night = await read();
check('night is night', night.night >= .6 && night.day <= .4, { night: night.night, day: night.day });
check('night key light dims against noon', night.sun < noon.sun, { noon: noon.sun, night: night.sun, ratio: +(night.sun / Math.max(1e-6, noon.sun)).toFixed(3) });
check('night keeps light grading', night.dof > 0 && night.bloom === true, { dof: night.dof, bloom: night.bloom });

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
const out = path.join(QA_DIR, 'light-quality-night.png');
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('SCREENSHOT', out);

/* 5 - the Drive easter egg still gets its native lamps. */
await ev(`window.DavisTwin.drive()`);
await sleep(1800);
const drive = await ev(`(()=>{const d=window.__DAVIS_TWIN_DEBUG__;return{on:!!d.drive.on,packed:!!d.drive.packedCar,head:(d.drive.packHeadMats||[]).length,tail:(d.drive.packTailMats||[]).length}})()`);
check('drive native lamps', drive.packed && drive.head > 0 && drive.tail > 0, drive);
await ev(`window.DavisTwin.drive()`);
await sleep(600);

console.log('RESULT', JSON.stringify({ noon, wet, night, drive }));
if (errors.length) { console.error('BROWSER ERRORS', JSON.stringify(errors.slice(0, 5))); failures.push('browser errors'); }
else console.log('NO BROWSER ERRORS');
if (failures.length) { console.error('FAILED CHECKS', JSON.stringify(failures)); process.exitCode = 1; }
else console.log('LIGHT QUALITY OK');

chrome.kill('SIGKILL'); server.close();
