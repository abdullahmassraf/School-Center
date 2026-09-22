/* Headless acceptance test for the iframe-backed Davis twin + fullscreen/drive/cinematic interaction upgrade. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fsio from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd(),PORT=8984,DEBUG_PORT=9284;
const CHROME=['chromium','chromium-browser','google-chrome','google-chrome-stable'].find(c=>{try{execFileSync('which',[c],{stdio:'ignore'});return true}catch{return false}});
if(!CHROME){console.error('no chromium');process.exit(2)}

const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''),file=path.join(ROOT,rel||'index.html');
  if(!file.startsWith(ROOT)||!fsio.existsSync(file)||fsio.statSync(file).isDirectory()){res.statusCode=404;res.end('nf');return}
  res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');res.end(fsio.readFileSync(file));
});
await new Promise(r=>server.listen(PORT,r));

const profile=fsio.mkdtempSync('/tmp/sc-map-fullscreen-');
const chrome=spawn(CHROME,['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--enable-gpu','--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--enable-webgl','--ignore-gpu-blocklist',`--remote-debugging-port=${DEBUG_PORT}`,`--user-data-dir=${profile}`,'--window-size=1280,900'],{stdio:'ignore'});

let target;
for(let i=0;i<120&&!target;i++){try{target=(await(await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t=>t.type==='page')}catch{}await new Promise(r=>setTimeout(r,250))}
if(!target)throw new Error('no CDP page after 30 seconds; Chromium failed to expose remote debugging');

const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=ev=>{const d=JSON.parse(ev.data);if(d.id&&pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails?.exception?.description||d.params.exceptionDetails?.text||'exception');if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push(d.params.args?.map(a=>a.value).join(' ')||'console error')};
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++seq;pending.set(i,resolve);ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(pending.has(i)){pending.delete(i);reject(new Error(`CDP timeout: ${method}`))}},20000)});
const ev=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.result?.exceptionDetails)throw new Error(d.result.exceptionDetails.exception?.description||'eval error');return d.result.result.value};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clickSelectorInFrame=async selector=>{
  const p=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame,fb=f.getBoundingClientRect(),b=f.contentWindow.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:fb.left+b.left+b.width/2,y:fb.top+b.top+b.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y,button:'none',buttons:0});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1});
};
const clickSelector=async selector=>{
  const p=await ev(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y,button:'none',buttons:0});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1});
};
const key=async(code,up=true)=>{
  await ev('window.__SC_CAMPUS_MAP_3D__.frame.focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',code,key:code,key:code==='Escape'?'Escape':code.replace('Key',''),windowsVirtualKeyCode:code==='Escape'?27:code==='KeyD'?68:0});
  if(up) await send('Input.dispatchKeyEvent',{type:'keyUp',code,key:code==='Escape'?'Escape':code.replace('Key',''),windowsVirtualKeyCode:code==='Escape'?27:code==='KeyD'?68:0});
};

await send('Page.enable');await send('Runtime.enable');await send('Log.enable');
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html`});

let ready=false;
for(let i=0;i<40&&!ready;i++){await sleep(250);ready=await ev(`!!window.__SC_CAMPUS_MAP_3D__?.ready&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.DavisTwin&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__`)}
if(!ready)throw new Error('Davis twin did not become ready within 10 seconds');

const boot=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow,b=document.querySelector('.cm3d-fullscreen');return{ready:m.ready,embed:new URL(m.frame.src).searchParams.get('embed'),ids:f.DavisTwin.buildings,chips:document.querySelectorAll('[data-map-chip]').length,fsBtn:!!b,label:b?.getAttribute('aria-label'),buttonRect:b?.getBoundingClientRect().toJSON(),ui:['#title','#panel','#dock','#info','#compass','#hint','#loader','#fatal'].map(s=>[s,getComputedStyle(f.document.querySelector(s)).display==='none'])}})()`);
if(boot.embed!=='1'||!boot.ready||boot.chips!==6||!boot.fsBtn||boot.label!=='Enter fullscreen'||boot.buttonRect.width>34||boot.buttonRect.height>34||boot.buttonRect.width<30||boot.buttonRect.height<30||boot.ui.some(x=>!x[1]))throw new Error(`boot/UI contract failed: ${JSON.stringify(boot)}`);
for(const id of ['J','H','M','B','C','A'])if(!boot.ids.includes(id))throw new Error(`missing building ${id}`);
let assets;
for(let i=0;i<40;i++){
  assets=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{state:d.ASSET_STATE,paths:d.CAMPUS_ASSETS,trafficMode:d.traffic?.mode,parked:d.traffic?.parkedCount,moving:d.traffic?.cars?.length,transit:d.transit?.vehicles?.map(v=>({key:v.key,x:v.x,z:v.z,dir:v.dir}))}})()`);
  if(assets.state.car==='loaded'&&assets.state.transit.bus==='loaded'&&assets.state.transit.schoolBus==='loaded') break;
  await sleep(250);
}
if(assets.state.car!=='loaded'||assets.state.transit.bus!=='loaded'||assets.state.transit.schoolBus!=='loaded')throw new Error(`packed assets failed to load: ${JSON.stringify(assets)}`);
if(assets.trafficMode!=='packed'||assets.moving!==12||assets.transit.length!==2)throw new Error(`traffic/transit integration failed: ${JSON.stringify(assets)}`);
if(!String(assets.paths.normalCar).endsWith('/cars/NormalCar1.json.gz.b64')||!String(assets.paths.bus).endsWith('/transit/Bus.json.gz.b64')||!String(assets.paths.schoolBus).endsWith('/transit/SchoolBus.json.gz.b64'))throw new Error(`asset paths are not canonical: ${JSON.stringify(assets.paths)}`);
console.log('ASSETS',JSON.stringify(assets));
const transitBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.updatePublicTransport(1)`);
const transitAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
if(transitBefore.every((v,i)=>Math.abs(v-transitAfter[i])<.1))throw new Error(`public transport update produced no movement: ${JSON.stringify({before:transitBefore,after:transitAfter})}`);
console.log('TRANSIT MOTION',JSON.stringify({before:transitBefore,after:transitAfter}));
console.log('BOOT',JSON.stringify(boot));

const dOutside=await ev(`(()=>{window.__SC_CAMPUS_MAP_3D__.frame.focus();return window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on})()`);
await key('KeyD');
const dOutsideAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on`);
if(dOutside||dOutsideAfter)throw new Error(`D activated Drive outside fullscreen: ${dOutsideAfter}`);
console.log('DRIVE OUTSIDE FULLSCREEN: blocked');

await clickSelector('.cm3d-fullscreen');
await sleep(1200);
let fs=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow;return{host:!!document.fullscreenElement,twin:f.__DAVIS_TWIN_DEBUG__?.actualFullscreen(),label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),aspect:f.__DAVIS_TWIN_DEBUG__.camera.aspect,expected:innerWidth/innerHeight,calls:f.__DAVIS_TWIN_DEBUG__.renderer.info.render.calls}})()`);
if(!fs.host||!fs.twin||fs.label!=='Exit fullscreen'||Math.abs(fs.aspect-fs.expected)>.03)throw new Error(`fullscreen entry failed: ${JSON.stringify(fs)}`);
console.log('FULLSCREEN ENTER',JSON.stringify(fs));

await clickSelector('.cm3d-fullscreen');
await sleep(500);
fs=await ev(`(()=>({host:!!document.fullscreenElement,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),overflow:document.body.style.overflow}))()`);
if(fs.host||fs.label!=='Enter fullscreen'||fs.overflow!=='')throw new Error(`fullscreen exit button failed: ${JSON.stringify(fs)}`);
console.log('FULLSCREEN EXIT BUTTON',JSON.stringify(fs));

await clickSelector('.cm3d-fullscreen');
await sleep(900);
await ev(`(()=>{const w=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow;w.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',key:'d',bubbles:true}));return true})()`);
let drive;
for(let i=0;i<40;i++){
  await sleep(250);
  drive=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{on:d.drive.on,fs:d.actualFullscreen(),keys:{d:d.drive.keys.d},distance:d.driveCamera?.distance,packed:!!d.drive.packedCar,physics:!!d.drive.world}})()`);
  if(drive.on&&drive.packed)break;
}
if(!drive.on||!drive.fs||!drive.packed)throw new Error(`fullscreen D/packed car failed after 10s: ${JSON.stringify(drive)}`);
await key('KeyD');
const steer=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on`);
if(!steer)throw new Error('second D toggled Drive off');
console.log('DRIVE EASTER EGG',JSON.stringify(drive));

await key('Escape');
await sleep(900);
const afterEsc=await ev(`(()=>({fs:!!document.fullscreenElement,drive:window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on}))()`);
if(afterEsc.drive)throw new Error(`Escape did not exit Drive: ${JSON.stringify(afterEsc)}`);
console.log('ESCAPE DRIVE EXIT',JSON.stringify(afterEsc));
/* Browser-level Escape exits native fullscreen; the CDP key is intentionally scoped to the iframe,
 * so keep fullscreen on here and verify that the map's explicit fullscreen control still exits it. */
await clickSelector('.cm3d-fullscreen'); await sleep(500);
const afterFs=await ev(`(()=>({host:!!document.fullscreenElement,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label')}))()`);
if(afterFs.host||afterFs.label!=='Enter fullscreen')throw new Error(`fullscreen cleanup failed: ${JSON.stringify(afterFs)}`);

await ev(`window.__SC_CAMPUS_MAP_3D__.reset()`);
await sleep(300);

/* Smart Drive chase: the existing Drive physics is reused. Hold forward long
 * enough to move, then verify automatic rear alignment engages. */
await clickSelector('.cm3d-fullscreen'); await sleep(400); await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.DavisTwin.drive()`); await sleep(500);
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const q=d.drive.body.rotation();d.drive.q.set(q.x,q.y,q.z,q.w);d.drive.fwd.set(0,0,-1).applyQuaternion(d.drive.q).normalize();d.drive.body.setLinvel({x:d.drive.fwd.x*12,y:0,z:d.drive.fwd.z*12},true);d.driveCamera.userRotating=false;d.driveCamera.releaseAt=performance.now()-800;return true})()`);
await sleep(180);
const moving=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const p=d.drive.body.linvel();const cp=d.camera.position;const tp=d.controls.target;return{speed:Math.hypot(p.x,p.z),chase:d.driveCamera.chaseStrength,rotating:d.driveCamera.userRotating,cam:[cp.x,cp.y,cp.z],target:[tp.x,tp.y,tp.z]}})()`);
if(moving.speed<0.5||moving.rotating)throw new Error(`deterministic Drive motion failed: ${JSON.stringify(moving)}`);
await sleep(900);
const chased=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const cp=d.camera.position;const tp=d.controls.target;return{strength:d.driveCamera.chaseStrength,cam:[cp.x,cp.y,cp.z],target:[tp.x,tp.y,tp.z]}})()`);
const camDelta=Math.hypot(chased.cam[0]-moving.cam[0],chased.cam[1]-moving.cam[1],chased.cam[2]-moving.cam[2]);
const targetDelta=Math.hypot(chased.target[0]-moving.target[0],chased.target[1]-moving.target[1],chased.target[2]-moving.target[2]);
if(camDelta<0.05||targetDelta<0.05||chased.strength<=0)throw new Error(`smart Drive chase did not move the camera rig: ${JSON.stringify({moving,chased,camDelta,targetDelta})}`);
console.log('SMART DRIVE CHASE',JSON.stringify({moving,chased,camDelta,targetDelta}));
await key('Escape'); await sleep(800);
await ev(`window.__SC_CAMPUS_MAP_3D__.reset()`);
await sleep(5000);

const idleOverview=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{sel:d.ST.sel,strength:d.interaction.idleStrength,pivot:d.interaction.pivotId,transition:d.interaction.cameraTransition}})()`);
if(idleOverview.sel!==null||idleOverview.pivot!==null||idleOverview.strength<.08||idleOverview.transition)throw new Error(`overview cinematic idle failed: ${JSON.stringify(idleOverview)}`);
console.log('CINEMATIC OVERVIEW',JSON.stringify(idleOverview));

await ev(`window.__SC_CAMPUS_MAP_3D__.focus('H')`);
await sleep(5000);
const idleSelected=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{sel:d.ST.sel,strength:d.interaction.idleStrength,pivot:d.interaction.pivotId,transition:d.interaction.cameraTransition,route:d.R.grp.visible}})()`);
if(idleSelected.sel!=='H'||idleSelected.pivot!=='H'||idleSelected.strength<.08||idleSelected.transition||!idleSelected.route)throw new Error(`selected cinematic idle failed: ${JSON.stringify(idleSelected)}`);
console.log('CINEMATIC SELECTED H',JSON.stringify(idleSelected));

const beforeManual=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.idleStrength`);
const drag=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame,fb=f.getBoundingClientRect();return{x:fb.left+fb.width/2,y:fb.top+fb.height/2}})()`);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',buttons:1,clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+100,y:drag.y+30,button:'left',buttons:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+100,y:drag.y+30,button:'left',buttons:0,clickCount:1});
await sleep(800);
const afterManual=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.idleStrength`);
if(afterManual>=beforeManual*.65&&afterManual>.18)throw new Error(`manual input did not suppress cinematic idle: ${beforeManual}->${afterManual}`);
console.log('CINEMATIC MANUAL OVERRIDE',JSON.stringify({before:beforeManual,after:afterManual}));

if(errors.length)throw new Error(`browser console errors: ${errors.slice(0,5).join(' | ')}`);
console.log('NO CONSOLE ERRORS');

chrome.kill('SIGKILL');server.close();