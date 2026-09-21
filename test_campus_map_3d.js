/* Headless acceptance test for the iframe-backed Davis twin. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd(),PORT=8982,DEBUG_PORT=9282;
const CHROME=['chromium','chromium-browser','google-chrome','google-chrome-stable'].find(c=>{try{execFileSync('which',[c],{stdio:'ignore'});return true}catch{return false}});
if(!CHROME){console.error('no chromium');process.exit(2)}
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''),file=path.join(ROOT,rel||'index.html');if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('nf');return}res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
await new Promise(r=>server.listen(PORT,r));
const profile=fs.mkdtempSync('/tmp/sc-map-');
const chrome=spawn(CHROME,['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--enable-gpu','--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--enable-webgl','--ignore-gpu-blocklist',`--remote-debugging-port=${DEBUG_PORT}`,`--user-data-dir=${profile}`,'--window-size=1280,900'],{stdio:'ignore'});
let target;for(let i=0;i<40&&!target;i++){try{target=(await(await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t=>t.type==='page')}catch{}await new Promise(r=>setTimeout(r,250))}
if(!target)throw new Error('no CDP page');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map(),errors=[];
ws.onmessage=ev=>{const d=JSON.parse(ev.data);if(d.id&&pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails?.exception?.description||d.params.exceptionDetails?.text||'exception');if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push('console error')};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error(`CDP timeout: ${method}`))}},20000)});
const ev=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.result?.exceptionDetails)throw new Error(d.result.exceptionDetails.exception?.description||'eval error');return d.result.result.value};
await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html`});
let ready=false;for(let i=0;i<120&&!ready;i++){await new Promise(r=>setTimeout(r,500));ready=await ev(`!!window.__SC_CAMPUS_MAP_3D__?.ready&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.DavisTwin`)}
if(!ready)throw new Error('Davis twin did not become ready within 60 seconds');

const boot=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow,hidden=s=>getComputedStyle(f.document.querySelector(s)).display==='none';return {embed:new URL(m.frame.src).searchParams.get('embed'),ui:['#title','#panel','#dock','#info','#compass','#hint','#loader','#fatal'].map(s=>[s,hidden(s)]),ids:f.DavisTwin.buildings,ready:m.ready}})()`);
if(boot.embed!=='1'||boot.ui.some(x=>!x[1]))throw new Error(`embed UI not hidden: ${JSON.stringify(boot)}`);
for(const id of ['J','H','M','B','C','A'])if(!boot.ids.includes(id))throw new Error(`missing building ${id}`);
console.log('BOOT',JSON.stringify(boot));

const focus=await ev(`(()=>{window.__SC_CAMPUS_MAP_3D__.focus('J');return new Promise(r=>setTimeout(()=>{const m=window.__SC_CAMPUS_MAP_3D__,d=m.frame.contentWindow.__DAVIS_TWIN_DEBUG__;r({host:m.focusId,twin:d?.ST.sel,route:d?.R.grp.visible,cam:m.camMode})},1000)})()`);
if(focus.host!=='J'||focus.twin!=='J'||!focus.route||focus.cam!=='focus')throw new Error(`J focus failed: ${JSON.stringify(focus)}`);

const buildings=await ev(`(async()=>{const o={};for(const id of ['H','M','B','C','A']){window.__SC_CAMPUS_MAP_3D__.focus(id);await new Promise(r=>setTimeout(r,300));const m=window.__SC_CAMPUS_MAP_3D__,d=m.frame.contentWindow.__DAVIS_TWIN_DEBUG__;o[id]={host:m.focusId,twin:d?.ST.sel,route:d?.R.grp.visible}}return o})()`);
for(const id of ['H','M','B','C','A'])if(buildings[id].host!==id||buildings[id].twin!==id||!buildings[id].route)throw new Error(`building ${id} failed`);
console.log('BUILDINGS',JSON.stringify(buildings));

const env=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,d=m.frame.contentWindow.__DAVIS_TWIN_DEBUG__;m.setWeather('rain');m.setSeason('winter');m.setTime('2026-12-21T21:30:00-05:00');document.documentElement.style.setProperty('--accent','#22d3ee');m.refreshAccent();return new Promise(r=>setTimeout(()=>r({rain:d.W.rain,snow:d.W.snow,season:d.ST.season,night:d.ST.night,accent:d.ST.accent.getHexString(),weather:m.weatherCondition}),500))})()`);
if(env.rain<.5||env.snow<.2||env.season!=='winter'||env.night<.5||env.accent!=='22d3ee')throw new Error(`environment protocol failed: ${JSON.stringify(env)}`);
console.log('ENV',JSON.stringify(env));

const reset=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__;m.reset();return new Promise(r=>setTimeout(()=>{const d=m.frame.contentWindow.__DAVIS_TWIN_DEBUG__;r({host:m.focusId,twin:d?.ST.sel,route:d?.R.grp.visible,cam:m.camMode})},1000)})()`);
if(reset.host!==null||reset.twin!==null||reset.route||reset.cam!=='overview')throw new Error(`reset failed: ${JSON.stringify(reset)}`);

const before=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__?.renderer.info.render.calls||0`);
await ev(`window.__SC_CAMPUS_MAP_3D__.resize()`);
const after=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__?.renderer.info.render.calls||0`);
console.log('RESET/RESIZE',JSON.stringify({reset,before,after}));
if(errors.length)throw new Error(`browser console errors: ${errors.slice(0,5).join(' | ')}`);
console.log('NO CONSOLE ERRORS');
chrome.kill('SIGKILL');server.close();
