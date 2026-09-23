/* Visual QA probe for the Davis campus twin.
 *
 * `test_campus_map_3d.js` is the behavioural regression suite; the two density
 * probes at its end capture their frame as soon as `DavisTwin` exists, which is
 * often still the loading gradient. This probe instead waits for the twin to
 * finish booting (loader hidden, canvas present) and for a composed frame, then
 * captures the same scene on a phone profile and a desktop profile in both
 * daylight and night so the night exposure and the lamp spill can be judged from
 * real frames. Screenshots land in qa-artifacts/ with a `vqa-` prefix.
 *
 * Usage: node probe_visual_qa.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(), PORT = 8985, DEBUG_PORT = 9285;
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

const profile = fs.mkdtempSync('/tmp/sc-vqa-');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-crash-reporter', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await new Promise(r => setTimeout(r, 250));
}
if (!target) { console.error('no CDP page'); process.exit(2); }

let ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const pending = new Map(), errors = [];
const route = e => {
  const d = JSON.parse(e.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || 'exception');
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console error');
};
ws.onmessage = route;
/* Emulation overrides are session-scoped, and this Chrome build does not always
 * drop a touch override when it is disabled - which would let the "desktop" pass
 * silently keep the phone profile. The desktop pass therefore runs in a freshly
 * created target, which carries no touch or device-metrics override. */
const openFreshTarget = async () => {
  const targetId = (await send('Target.createTarget', { url: 'about:blank' })).result.targetId;
  const wsUrl = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.id === targetId)?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('fresh target did not expose a debugger URL');
  const next = new WebSocket(wsUrl);
  await new Promise(r => next.onopen = r);
  next.onmessage = route; ws = next;
  await send('Page.enable'); await send('Runtime.enable');
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++seq; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); } }, 30000);
});
const ev = async expression => {
  const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'eval error');
  return d.result.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* The loader can finish before the module script publishes its debug surface, so
 * wait for that too before reading anything out of it. */
const waitUntil = async (expression, timeout = 90000, interval = 300) => {
  const started = Date.now(); let last;
  while (Date.now() - started < timeout) { last = await ev(expression); if (last) return last; await sleep(interval); }
  throw new Error('timeout waiting for ' + expression + '; last=' + JSON.stringify(last));
};
const QA_DIR = path.join(ROOT, 'qa-artifacts'); fs.mkdirSync(QA_DIR, { recursive: true });

/* The twin keeps its loader up until the campus assets are in, so wait for the
   loader to be gone (or the fatal card) before trusting a frame. */
const waitBooted = async (timeout = 120000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await ev(`(()=>{const f=document.querySelector('#fatal');if(f&&!f.hidden)return 'fatal';const l=document.querySelector('#loader');if(!l)return 'gone';return l.classList.contains('done')?'done':'loading'})()`);
    if (state === 'done' || state === 'gone') return state;
    if (state === 'fatal') throw new Error('the twin showed its fatal card: ' + await ev(`document.querySelector('#fatalMsg')?.textContent||''`));
    await sleep(400);
  }
  return 'timeout';
};
/* Two composed frames, then read the frame back so the surface capture cannot
   race the GPU process. */
const settleFrame = async () => {
  await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))`);
  await sleep(320);
};

const shot = async (name, note) => {
  const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const out = path.join(QA_DIR, `vqa-${name}.png`);
  fs.writeFileSync(out, Buffer.from(cap.result.data, 'base64'));
  console.log('SCREENSHOT', out, note || '');
};

const capture = async (label, { width, height, dsf, touch, url, views, fresh }) => {
  if (fresh) await openFreshTarget();
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: touch });
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${url}` });
  const state = await waitBooted();
  await waitUntil('!!window.__DAVIS_TWIN_DEBUG__');
  const info = await ev(`(()=>{const d=window.__DAVIS_TWIN_DEBUG__;return{ready:!!window.DavisTwin,mobileProfile:d.mobileProfile,tier:d.tierName,pr:d.renderer.getPixelRatio(),dpr:devicePixelRatio,dof:d.FX.dof,bloom:d.FX.bloom,night:d.ST.night,rain:d.W.rain,snow:d.W.snow,canvas:[d.renderer.domElement.clientWidth,d.renderer.domElement.clientHeight],fb:[d.renderer.domElement.width,d.renderer.domElement.height]}})()`);
  console.log('PROFILE', label, JSON.stringify({ loader: state, ...info }));
  for (const view of views) {
    if (view.set) await ev(view.set);
    await settleFrame();
    await shot(`${label}-${view.name}`, view.note);
  }
  return info;
};

/* Daylight overview, night overview and a night street-level look, on a phone. */
const mobile = await capture('phone', {
  width: 390, height: 844, dsf: 3, touch: true,
  url: 'campus-twin.html?debug=1&touchtest=1&weather=clear&quality=medium',
  views: [
    { name: 'day-overview', set: `(()=>{window.DavisTwin.setTime(Date.parse('2026-06-21T13:00:00-04:00'));return true})()`, note: 'noon overview' },
    { name: 'night-overview', set: `(()=>{window.DavisTwin.setTime(Date.parse('2026-09-20T21:30:00-04:00'));return true})()`, note: 'night overview' },
    { name: 'night-street', set: `(()=>{const d=window.__DAVIS_TWIN_DEBUG__,m=d.MAIN_INTERSECTION;d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.interaction.lastInput=performance.now();d.interaction.idleStrength=0;d.interaction.targetStrength=0;d.camera.position.set(m.x+16,9,m.z-30);d.controls.target.set(m.x,2,m.z);d.controls.update();return true})()`, note: 'night intersection' },
  ],
});

/* Same scene at full desktop quality: this is the tier that must not regress. */
const desktop = await capture('desktop', {
  width: 1440, height: 900, dsf: 1, touch: false, fresh: true,
  url: 'campus-twin.html?debug=1&quality=high&weather=clear',
  views: [
    { name: 'day-overview', set: `(()=>{window.DavisTwin.setTime(Date.parse('2026-06-21T13:00:00-04:00'));return true})()`, note: 'noon overview' },
    { name: 'night-overview', set: `(()=>{window.DavisTwin.setTime(Date.parse('2026-09-20T21:30:00-04:00'));return true})()`, note: 'night overview' },
    { name: 'night-street', set: `(()=>{const d=window.__DAVIS_TWIN_DEBUG__,m=d.MAIN_INTERSECTION;d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.interaction.lastInput=performance.now();d.interaction.idleStrength=0;d.interaction.targetStrength=0;d.camera.position.set(m.x+22,11,m.z-38);d.controls.target.set(m.x,2,m.z);d.controls.update();return true})()`, note: 'night intersection' },
  ],
});

console.log('SUMMARY', JSON.stringify({ mobile, desktop }));
if (errors.length) { console.error('BROWSER ERRORS', JSON.stringify(errors.slice(0, 5))); process.exitCode = 1; }
else console.log('NO BROWSER ERRORS');

chrome.kill('SIGKILL'); server.close();
