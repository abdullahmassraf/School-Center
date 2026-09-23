/* Headless acceptance test for the iframe-backed Davis twin + fullscreen/drive/cinematic interaction upgrade. */
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT=process.cwd(),PORT=8984,DEBUG_PORT=9284;
const CHROME_CANDIDATES = process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  : ['chromium','chromium-browser','google-chrome','google-chrome-stable'];
const CHROME=CHROME_CANDIDATES.find(c=>process.platform === 'win32' ? fs.existsSync(c) : (()=>{try{execFileSync('which',[c],{stdio:'ignore'});return true}catch{return false}})());
if(!CHROME){console.error('no chromium');process.exit(2)}

const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''),file=path.join(ROOT,rel||'index.html');
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end('nf');return}
  res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(PORT,r));

const profile=fs.mkdtempSync('/tmp/sc-map-fullscreen-');
const chromeArgs = [
  '--headless=new',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--enable-webgl',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-crash-reporter',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${profile}`,
  '--window-size=1280,900',
  'about:blank'
];
const chrome=spawn(CHROME,chromeArgs,{stdio:['ignore','pipe','pipe']});
let chromeStdout='', chromeStderr='';
chrome.stdout?.on('data',b=>{chromeStdout+=b.toString();});
chrome.stderr?.on('data',b=>{chromeStderr+=b.toString();});

let target, cdpVersion = null, cdpLastError = null;
for(let i=0;i<120&&!target;i++){
  if (chrome.exitCode !== null) break;
  try{
    const vr=await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if(vr.ok) cdpVersion=await vr.json();
  }catch(e){ cdpLastError=String(e?.message||e); }
  try{
    const lr=await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    if(lr.ok) target=(await lr.json()).find(t=>t.type==='page');
  }catch(e){ cdpLastError=String(e?.message||e); }
  if(!target) await new Promise(r=>setTimeout(r,250));
}
if(!target)throw new Error(`no CDP page (exitCode=${chrome.exitCode}, signal=${chrome.signalCode}, version=${JSON.stringify(cdpVersion)}, lastError=${cdpLastError||'none'}, stdout=${JSON.stringify(chromeStdout.slice(-2000))}, stderr=${JSON.stringify(chromeStderr.slice(-4000))}, chrome=${CHROME})`);

const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let seq=0;const pending=new Map(),errors=[],assetResponses=[];
ws.onmessage=ev=>{const d=JSON.parse(ev.data);if(d.id&&pending.has(d.id)){pending.get(d.id)(d);pending.delete(d.id)}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails?.exception?.description||d.params.exceptionDetails?.text||'exception');if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')errors.push(d.params.args?.map(a=>a.value).join(' ')||'console error');if(d.method==='Network.responseReceived'&&/assets\/campus\/(cars|transit)\/.*\.(obj|mtl)$/i.test(d.params.response.url))assetResponses.push({url:d.params.response.url,status:d.params.response.status});};
const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++seq;pending.set(i,resolve);ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(pending.has(i)){pending.delete(i);reject(new Error(`CDP timeout: ${method}`))}},20000)});
const ev=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.result?.exceptionDetails)throw new Error(d.result.exceptionDetails.exception?.description||'eval error');return d.result.result.value};
const waitFor=async(expression,timeout=10000,interval=120)=>{
  const started=Date.now(); let last;
  while(Date.now()-started<timeout){last=await ev(expression);if(last) return last;await sleep(interval);}
  throw new Error(`timeout waiting for ${expression}; last=${JSON.stringify(last)}`);
};
const QA_DIR=path.join(ROOT,'qa-artifacts');fs.mkdirSync(QA_DIR,{recursive:true});
const screenshot=async name=>{
  const autoWas=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__,v=d?.AUTO?.on??false;if(d){d.AUTO.on=false;d.interaction.lastInput=performance.now();d.interaction.idleStrength=0;d.interaction.targetStrength=0;}document.querySelector('#cm3d-mount iframe')?.scrollIntoView({block:'center',inline:'center'});return v})()`);
  await sleep(220);
  /* CDP clip coordinates are page-space. The old helper passed viewport-space
   * iframe bounds after scrolling, so CI captured unrelated page sections even
   * though the 3D camera assertions passed. */
  const clip=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__?.frame,r=f?.getBoundingClientRect?.();return r&&r.width>4&&r.height>4?{x:scrollX+r.left,y:scrollY+r.top,width:r.width,height:r.height,scale:1}:null})()`);
  if(!clip)throw new Error('campus map iframe clip unavailable for screenshot');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true,clip});
  const out=path.join(QA_DIR,name+'.png');
  fs.writeFileSync(out,Buffer.from(shot.result.data,'base64'));
  await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__;if(d){d.AUTO.on=${JSON.stringify(autoWas)};d.interaction.lastInput=performance.now();}return true})()`);
  console.log('SCREENSHOT',out);
};
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

await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html`});

let ready=false;
for(let i=0;i<120&&!ready;i++){await sleep(500);ready=await ev(`!!window.__SC_CAMPUS_MAP_3D__?.ready&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.DavisTwin&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__`)}
if(!ready)throw new Error('Davis twin did not become ready within 60 seconds');

const boot=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow,b=document.querySelector('.cm3d-fullscreen');return{ready:m.ready,embed:new URL(m.frame.src).searchParams.get('embed'),ids:f.DavisTwin.buildings,chips:document.querySelectorAll('[data-map-chip]').length,fsBtn:!!b,label:b?.getAttribute('aria-label'),buttonRect:b?.getBoundingClientRect().toJSON(),ui:['#title','#panel','#dock','#info','#compass','#hint','#loader','#fatal'].map(s=>[s,getComputedStyle(f.document.querySelector(s)).display==='none'])}})()`);
if(boot.embed!=='1'||!boot.ready||boot.chips!==6||!boot.fsBtn||boot.label!=='Enter fullscreen'||boot.buttonRect.width>34||boot.buttonRect.height>34||boot.buttonRect.width<30||boot.buttonRect.height<30||boot.ui.some(x=>!x[1]))throw new Error(`boot/UI contract failed: ${JSON.stringify(boot)}`);
for(const id of ['J','H','M','B','C','A'])if(!boot.ids.includes(id))throw new Error(`missing building ${id}`);
for(let i=0;i<100;i++){
  const loaded=await ev(`(()=>{const s=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ASSET_STATE;return s.car!=='pending'&&s.transit.bus!=='pending'&&s.transit.schoolBus!=='pending'})()`);
  if(loaded)break;
  await sleep(100);
}
const assets=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{state:d.ASSET_STATE,paths:d.CAMPUS_ASSETS,trafficMode:d.traffic?.mode,parked:d.traffic?.parkedCount,moving:d.traffic?.cars?.length,transit:d.transit?.vehicles?.map(v=>({key:v.key,x:v.x,z:v.z,dir:v.dir}))}})()`);
if(assets.state.car!=='loaded'||assets.state.transit.bus!=='loaded'||assets.state.transit.schoolBus!=='loaded')throw new Error(`packed assets failed to load: ${JSON.stringify(assets)}`);
if(assets.trafficMode!=='packed'||assets.moving!==12||assets.transit.length!==2)throw new Error(`traffic/transit integration failed: ${JSON.stringify(assets)}`);
if(!String(assets.paths.normalCar).endsWith('/cars/Realistic Car Pack - Nov 2018/OBJ/NormalCar1.obj')||!String(assets.paths.bus).endsWith('/transit/Public Transport Pack - Feb 2017/OBJ/Bus.obj')||!String(assets.paths.schoolBus).endsWith('/transit/Public Transport Pack - Feb 2017/OBJ/SchoolBus.obj'))throw new Error(`asset paths are not canonical: ${JSON.stringify(assets.paths)}`);
const vehicleAppearance=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const roots=d.traffic?.set?.roots||[];const colors=new Set(),models=new Set(),materials=new Set();roots.slice(0,80).forEach(r=>{if(r.userData.vehicleColor)colors.add(r.userData.vehicleColor);if(r.userData.vehicleModel)models.add(r.userData.vehicleModel);r.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m?.color)materials.add(m.color.getHexString())})}})});const matColors=root=>{const out=[];root?.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.color&&out.push(m.color.getHexString()))}});return [...new Set(out)]};return{modelCount:d.traffic?.modelCount,modelNames:d.traffic?.modelNames,trafficColors:[...colors],trafficModels:[...models],trafficMaterialColors:[...materials],bus:matColors(d.transit?.vehicles?.find(v=>v.key==='bus')?.root),schoolBus:matColors(d.transit?.vehicles?.find(v=>v.key==='schoolBus')?.root)}})()`);
if(vehicleAppearance.modelCount<4||vehicleAppearance.trafficModels.length<3||vehicleAppearance.trafficColors.length<4)throw new Error(`traffic did not diversify native models/paint: ${JSON.stringify(vehicleAppearance)}`);
if(vehicleAppearance.bus.length<2||vehicleAppearance.schoolBus.length<2)throw new Error(`transit material styling was not applied: ${JSON.stringify(vehicleAppearance)}`);
const materialBindings=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const dump=root=>{const a=[];root?.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];a.push({mesh:o.name,materials:ms.map(m=>({name:m?.name,color:m?.color?.getHexString()}))})}});return a};return{bus:dump(d.transit?.vehicles?.find(v=>v.key==='bus')?.root),schoolBus:dump(d.transit?.vehicles?.find(v=>v.key==='schoolBus')?.root),drive:dump(d.drive?.packedCar)}})()`);
console.log('VEHICLE APPEARANCE',JSON.stringify({vehicleAppearance,materialBindings}));
/* Drive physics/assets are lazy-loaded. Before the Drive easter egg is activated
 * there may be no packed player mesh yet, so defer its native-material assertion
 * until the Drive lifecycle section below. */
const distinctColors=list=>[...new Set((list||[]).map(m=>m.color))];
for(const key of ['bus','schoolBus']){const groups=materialBindings[key]||[],colors=distinctColors(groups.flatMap(g=>g.materials));if(colors.length<5)throw new Error(`${key} did not receive distinct body/window/trim/light/wheel materials: ${JSON.stringify(materialBindings[key])}`)}
/* A "gray shell" is a transit asset whose materials all desaturate to grey; the
 * body paint must stay chromatic so the bus and the school bus stay distinct. */
const saturation=hex=>{const r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b);return mx===0?0:(mx-mn)/mx};
const transitWheelFit=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return d.transit.vehicles.map(v=>({key:v.key,wheels:(v.wheelRigs||[]).map(w=>({name:w.node.name,fit:w.pivot.userData.nativeWheelFit,diameter:w.pivot.userData.nativeWheelDiameter,radius:w.radius,axis:w.pivot.userData.transitWheelAxis,base:[w.baseX,w.baseY,w.baseZ],localSize:w.pivot.userData.nativeWheelLocalSize,centerBefore:w.pivot.userData.originalCenter,centerAfter:w.pivot.userData.centerAfterPivot,matrixError:w.pivot.userData.reparentWorldMatrixError}))}))})()`);
for(const v of transitWheelFit){
  if(v.wheels.length<2)throw new Error("transit wheel rigs missing: "+JSON.stringify(v));
  for(const w of v.wheels){
    if(Math.abs(w.fit-1)>.001||!Number.isFinite(w.diameter)||w.diameter<=.55||w.diameter>=1.4)throw new Error("transit native wheel geometry was rescaled unexpectedly: "+JSON.stringify(v));
    if(w.axis!=="z"||Math.abs(w.base[0])>.01||Math.abs(w.base[1])>.01||Math.abs(w.base[2])>.01)throw new Error("transit native wheel axle was rotated away from source Z: "+JSON.stringify(v));
    if(Math.max(...w.centerBefore.map((x,i)=>Math.abs(x-w.centerAfter[i])))>.002||w.matrixError>.0001)throw new Error("transit wheel pivot did not preserve the source transform: "+JSON.stringify(v));
    const dims=[...w.localSize].sort((a,b)=>b-a);
    if(!(dims[0]>dims[1]*3.5&&Math.abs(dims[1]-dims[2])<.08))throw new Error("transit wheel geometry no longer looks like a two-wheel Z axle: "+JSON.stringify(v));
  }
}
console.log("TRANSIT WHEEL GEOMETRY/AXIS",JSON.stringify(transitWheelFit));
for(const [key,list] of [['bus',vehicleAppearance.bus],['schoolBus',vehicleAppearance.schoolBus]])if(!list.some(c=>saturation(c)>.25))throw new Error(`${key} renders as a gray shell with no distinct body paint: ${JSON.stringify(list)}`);
console.log('MATERIAL SLOT PRESERVATION',JSON.stringify({busDistinct:distinctColors((materialBindings.bus||[]).flatMap(g=>g.materials)),schoolBusDistinct:distinctColors((materialBindings.schoolBus||[]).flatMap(g=>g.materials))}));
/* The reported black rectangle is the native front windshield on the transit
 * body mesh, not a wheel. Guard against reintroducing a near-black Windows
 * material that turns those large rectangular faces opaque-looking at range. */
for(const [key,groups] of [['bus',materialBindings.bus],['schoolBus',materialBindings.schoolBus]]){
  const windows=(groups||[]).flatMap(g=>g.materials.filter(m=>/^windows$/i.test(m.name||'')));
  if(!windows.length)throw new Error(key+' native Windows material missing');
  for(const w of windows){
    const hex=w.color||'000000',r=parseInt(hex.slice(0,2),16)/255,g=parseInt(hex.slice(2,4),16)/255,b=parseInt(hex.slice(4,6),16)/255;
    const luma=.2126*r+.7152*g+.0722*b;
    if(luma<.20)throw new Error(key+' front windshield regressed to a black rectangle: '+JSON.stringify({hex,luma,windows}));
  }
}
console.log('TRANSIT WINDSHIELD MATERIALS: visible glass, not black');
await sleep(250);
const assetStatuses=Object.fromEntries(assetResponses.map(r=>[r.url.split('/').pop(),r.status]));
for(const name of ['NormalCar1.obj','NormalCar1.mtl','Bus.obj','Bus.mtl','SchoolBus.obj','SchoolBus.mtl'])if(assetStatuses[name]!==200)throw new Error(`vehicle asset network request failed: ${JSON.stringify({name,status:assetStatuses[name],assetResponses})}`);
console.log('ASSETS',JSON.stringify({assets,assetStatuses}));
const frameVehicle=async(key,localOffset,name)=>{
  await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,v=d.transit.vehicles.find(v=>v.key===${JSON.stringify(key)});if(d.__qaVisibility){for(const [o,vis] of d.__qaVisibility)o.visible=vis;}d.__qaVisibility=d.scene.children.map(o=>[o,o.visible]);for(const o of d.scene.children)if(o!==v.root&&!o.isLight)o.visible=false;v.root.visible=true;d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.interaction.lastInput=performance.now();d.interaction.idleStrength=0;d.interaction.targetStrength=0;v.speed=0;v.stopTimer=999;v.root.updateMatrixWorld(true);const box=new d.THREE.Box3().setFromObject(v.root),p=box.getCenter(new d.THREE.Vector3()),q=v.root.getWorldQuaternion(new d.THREE.Quaternion()),off=new d.THREE.Vector3(${localOffset[0]},${localOffset[1]},${localOffset[2]}).applyQuaternion(q);d.camera.position.copy(p).add(off);d.controls.target.copy(p);d.controls.update();return{center:p.toArray(),size:box.getSize(new d.THREE.Vector3()).toArray(),cam:d.camera.position.toArray()}})()`);
  await sleep(180);await screenshot(name);
};
await frameVehicle('bus',[-8,3.2,5.5],'transit-bus-close');
await frameVehicle('bus',[-38,20,24],'transit-bus-far');
await frameVehicle('bus',[-9,2.6,0],'transit-bus-front');
await frameVehicle('bus',[9,2.6,0],'transit-bus-rear');
await frameVehicle('schoolBus',[-11,4.4,7.5],'transit-schoolbus-close');
await frameVehicle('schoolBus',[-9,2.6,0],'transit-schoolbus-front');
await frameVehicle('schoolBus',[9,2.6,0],'transit-schoolbus-rear');
await frameVehicle('schoolBus',[-38,20,24],'transit-schoolbus-far');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;if(d.__qaVisibility){for(const [o,vis] of d.__qaVisibility)o.visible=vis;d.__qaVisibility=null;}for(const v of d.transit.vehicles){v.speed=v.key==='bus'?10.5:8.5;v.stopTimer=0;}return true})()`);
const transitBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
await new Promise(r=>setTimeout(r,1200));
const transitAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
if(transitBefore.every((v,i)=>Math.abs(v-transitAfter[i])<.1))throw new Error(`public transport is not moving: ${JSON.stringify({before:transitBefore,after:transitAfter})}`);
console.log('TRANSIT MOTION',JSON.stringify({before:transitBefore,after:transitAfter}));
console.log('BOOT',JSON.stringify(boot));

/* Sunset/night lighting regression: moving NPC cars, commute buses and their
 * lamp materials must become active when the sun is below the horizon. */
await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,e=f.document.querySelector('#timeRange');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`);
await sleep(700);
const nightLights=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const matState=r=>({head:r?.headMaterials?.map(m=>m.emissiveIntensity)||[],tail:r?.tailMaterials?.map(m=>m.emissiveIntensity)||[],shared:r?.sharedLampMaterials?.map(m=>m.emissiveIntensity)||[],headGlow:r?.headGlows?.map(g=>g.material.opacity)||[],tailGlow:r?.tailGlows?.map(g=>g.material.opacity)||[],headDynamic:r?.headLights?.map(l=>({i:l.intensity,v:l.visible}))||[],tailDynamic:r?.tailLights?.map(l=>({i:l.intensity,v:l.visible}))||[]});return{
  night:d.ST.night,
  traffic:(d.traffic?.cars||[]).map(c=>matState(c.lightRig)),
  transit:(d.transit?.vehicles||[]).map(v=>{let receive=true;v.root.traverse(o=>{if(o.isMesh&&o.receiveShadow)receive=false});return{key:v.key,receiveShadow:receive,...matState(v.lightRig)}})
}})()`);
if(nightLights.night<.85)throw new Error('night time did not produce a strong night state: '+JSON.stringify(nightLights));
for(const car of nightLights.traffic){
  if(!car.head.length||!car.head.some(v=>v>0)||!car.tail.length||!car.tail.some(v=>v>0))throw new Error('moving NPC emissive lamps did not activate: '+JSON.stringify(car));
}
for(const bus of nightLights.transit){
  if(!bus.shared.length||!bus.shared.some(v=>v>0)||!bus.headGlow.every(v=>v>.1)||!bus.tailGlow.every(v=>v>.1))throw new Error('commute emissive/glow lamps did not activate: '+JSON.stringify(bus));
  if(!bus.receiveShadow)throw new Error('commute vehicle shadow receiver is still enabled: '+JSON.stringify(bus));
}
const activeDynamic=[...nightLights.traffic,...nightLights.transit].filter(r=>r.headDynamic.some(l=>l.v&&l.i>0)||r.tailDynamic.some(l=>l.v&&l.i>0)).length;
if(activeDynamic>6)throw new Error('vehicle dynamic-light budget exceeded: '+JSON.stringify({activeDynamic,nightLights}));
console.log('NIGHT VEHICLE LIGHTS',JSON.stringify({night:nightLights.night,activeDynamic}));

const nearRig=async(kind)=>{
  await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const r=${kind==='traffic'?'d.traffic.cars[0].lightRig':"d.transit.vehicles.find(v=>v.key==='bus').lightRig"},p=r.root.getWorldPosition(new d.THREE.Vector3());d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.camera.position.set(p.x+5,p.y+3,p.z+5);d.controls.target.copy(p);d.controls.update();d.refreshVehicleLightBudget();return true})()`);
  await sleep(120);
  return ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,r=${kind==='traffic'?'d.traffic.cars[0].lightRig':"d.transit.vehicles.find(v=>v.key==='bus').lightRig"};return{head:r.headLights.map(l=>({i:l.intensity,v:l.visible})),tail:r.tailLights.map(l=>({i:l.intensity,v:l.visible}))}})()`);
};
const nearTraffic=await nearRig('traffic'),nearBus=await nearRig('bus');
for(const [kind,state] of [['traffic',nearTraffic],['bus',nearBus]])if(!state.head.some(l=>l.v&&l.i>0)||!state.tail.some(l=>l.v&&l.i>0))throw new Error(kind+' near-camera dynamic lights did not activate: '+JSON.stringify(state));
console.log('NEAR VEHICLE DYNAMIC LIGHTS',JSON.stringify({nearTraffic,nearBus}));
const transitLampSemantics=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return d.transit.vehicles.map(v=>({key:v.key,head:v.lightRig.headAnchors.map(p=>p.toArray()),tail:v.lightRig.tailAnchors.map(p=>p.toArray()),forward:v.lightRig.forward.toArray(),headGlow:v.lightRig.headGlows.map(g=>g.material.opacity),tailGlow:v.lightRig.tailGlows.map(g=>g.material.opacity)}))})()`);
for(const v of transitLampSemantics){
  if(!(v.forward[0]<-.9&&v.head.every(p=>p[0]<0)&&v.tail.every(p=>p[0]>0)))throw new Error('transit front/rear lamp anchors do not follow native -X front: '+JSON.stringify(v));
  if(!v.headGlow.every(x=>x>.1)||!v.tailGlow.every(x=>x>.1))throw new Error('transit lamp glows did not activate at night: '+JSON.stringify(v));
}
console.log('TRANSIT LAMP SEMANTICS',JSON.stringify(transitLampSemantics));
await screenshot('vehicle-night-transit');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,cars=(d.traffic?.cars||[]);if(!cars.length)return false;const root=cars[0].lightRig.root,box=new d.THREE.Box3().setFromObject(root),p=box.getCenter(new d.THREE.Vector3());d.camera.position.set(p.x+12,p.y+4,p.z+10);d.controls.target.copy(p);d.controls.update();return true})()`);
await sleep(300);await screenshot('vehicle-night-traffic');

const dOutside=await ev(`(()=>{window.__SC_CAMPUS_MAP_3D__.frame.focus();return window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on})()`);
await key('KeyD');
const dOutsideAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on`);
if(dOutside||dOutsideAfter)throw new Error(`D activated Drive outside fullscreen: ${dOutsideAfter}`);
console.log('DRIVE OUTSIDE FULLSCREEN: blocked');

await clickSelector('.cm3d-fullscreen');
await sleep(600);
let fullscreenState=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow;return{host:!!document.fullscreenElement,twin:f.__DAVIS_TWIN_DEBUG__?.actualFullscreen(),label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),aspect:f.__DAVIS_TWIN_DEBUG__.camera.aspect,expected:f.__DAVIS_TWIN_DEBUG__.renderer.domElement.clientWidth/f.__DAVIS_TWIN_DEBUG__.renderer.domElement.clientHeight,calls:f.__DAVIS_TWIN_DEBUG__.renderer.info.render.calls}})()`);
if(!fullscreenState.host||!fullscreenState.twin||fullscreenState.label!=='Exit fullscreen'||Math.abs(fullscreenState.aspect-fullscreenState.expected)>.03)throw new Error(`fullscreen entry failed: ${JSON.stringify(fullscreenState)}`);
console.log('FULLSCREEN ENTER',JSON.stringify(fullscreenState));

await clickSelector('.cm3d-fullscreen');
await sleep(500);
fullscreenState=await ev(`(()=>({host:!!document.fullscreenElement,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),overflow:document.body.style.overflow}))()`);
if(fullscreenState.host||fullscreenState.label!=='Enter fullscreen'||fullscreenState.overflow!=='')throw new Error(`fullscreen exit button failed: ${JSON.stringify(fullscreenState)}`);
console.log('FULLSCREEN EXIT BUTTON',JSON.stringify(fullscreenState));

await clickSelector('.cm3d-fullscreen');
await sleep(400);
await key('KeyD');
await waitFor(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return d.drive.on&&!!d.drive.packedCar})()`,12000,150);
let drive=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{on:d.drive.on,fs:d.actualFullscreen(),keys:{d:d.drive.keys.d},distance:d.driveCamera?.distance,packed:!!d.drive.packedCar}})()`);
if(!drive.on||!drive.fs||!drive.packed)throw new Error(`fullscreen D/packed car failed: ${JSON.stringify({drive,errors})}`);
const driveLightRig=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,r=d.drive.lightRig;return{
  head:r?.headAnchors?.map((p,i)=>({anchor:[p.x,p.y,p.z],light:[r.headLights[i]?.position.x,r.headLights[i]?.position.y,r.headLights[i]?.position.z]})),
  tail:r?.tailAnchors?.map((p,i)=>({anchor:[p.x,p.y,p.z],light:[r.tailLights[i]?.position.x,r.tailLights[i]?.position.y,r.tailLights[i]?.position.z]})),
  oldBeam:!!d.drive.beamMat,oldPool:!!d.drive.poolM,shadowReceiver:d.drive.packedCar.traverse?.(()=>{})
}})()`);
for(const side of ['head','tail'])for(const w of (driveLightRig[side]||[])){
  if(Math.hypot(w.anchor[0]-w.light[0],w.anchor[1]-w.light[1],w.anchor[2]-w.light[2])>.001)throw new Error('Drive native lamp light is detached from its anchor: '+JSON.stringify(driveLightRig));
}
if(driveLightRig.oldBeam||driveLightRig.oldPool)throw new Error('legacy fixed-position Drive beam geometry is still present: '+JSON.stringify(driveLightRig));
const playerLampGeometry=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,r=d.drive.lightRig;return{head:r.headAnchors.map(p=>p.toArray()),tail:r.tailAnchors.map(p=>p.toArray()),forward:r.forward.toArray(),targets:r.headLights.map(l=>l.userData.target.position.toArray())}})()`);
if(!(playerLampGeometry.head.every(p=>p[2]>1.7)&&playerLampGeometry.tail.every(p=>p[2]<-1.7)&&playerLampGeometry.forward[2]>.9))throw new Error('player native lamp semantics are inverted: '+JSON.stringify(playerLampGeometry));
for(let i=0;i<playerLampGeometry.head.length;i++)if(playerLampGeometry.targets[i][2]<=playerLampGeometry.head[i][2])throw new Error('player spotlight target is not forward of the native headlight: '+JSON.stringify(playerLampGeometry));
console.log('DRIVE NATIVE LIGHT ALIGNMENT',JSON.stringify({driveLightRig,playerLampGeometry}));
const playerAppearance=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const mats=[];d.drive.packedCar.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.color&&mats.push(m.color.getHexString()))}});return{model:d.drive.packedCar.userData.vehicleModel,color:d.drive.packedCar.userData.vehicleColor,materials:[...new Set(mats)]}})()`);
if(playerAppearance.model!=='NormalCar1'||playerAppearance.color!=='#1f4d8a')throw new Error(`Drive did not use the intended native NormalCar1 visual: ${JSON.stringify(playerAppearance)}`);
const driveBindings=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const out=[];d.drive.packedCar.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];out.push({mesh:o.name,materials:ms.map(m=>({name:m?.name,color:m?.color?.getHexString()}))})}});return out})()`);
const driveBody=driveBindings.find(m=>/NormalCar1_Cube/i.test(m.mesh||''));
if(!driveBody||driveBody.materials.length<5)throw new Error(`Drive body lost its native material groups: ${JSON.stringify(driveBody)}`);
for(const slot of ['Blue','Windows','Headlights','TailLights'])if(!driveBody.materials.some(m=>m.name===slot))throw new Error(`Drive body is missing the native ${slot} material slot: ${JSON.stringify(driveBody.materials)}`);
const driveWindow=driveBody.materials.find(m=>m.name==='Windows');
if(!driveWindow||driveWindow.color==='070707'||driveWindow.color==='000000')throw new Error('Drive windshield regressed to a black rectangle: '+JSON.stringify(driveBody));
console.log('DRIVE MATERIALS',JSON.stringify(driveBody));
const drivePerf=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{active:d.drivePerf.active,dpr:d.renderer.getPixelRatio(),dof:d.CU.uDof.value,bloom:d.CU.uBloom.value,maxPr:d.drivePerf.maxPr}})()`);
if(!drivePerf.active||drivePerf.dof!==0||drivePerf.bloom!==0||drivePerf.dpr>(drivePerf.maxPr+.02))throw new Error("Drive performance mode did not activate cleanly: "+JSON.stringify(drivePerf));
console.log("DRIVE PERFORMANCE MODE",JSON.stringify(drivePerf));
console.log('PLAYER APPEARANCE',JSON.stringify(playerAppearance));
await sleep(500);
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,r=d.drive.packedCar;r.updateMatrixWorld(true);const box=new d.THREE.Box3().setFromObject(r),p=box.getCenter(new d.THREE.Vector3()),q=r.getWorldQuaternion(new d.THREE.Quaternion()),front=new d.THREE.Vector3(0,0,1).applyQuaternion(q),side=new d.THREE.Vector3(1,0,0).applyQuaternion(q);d.driveCamera.userRotating=true;d.camera.position.copy(p).addScaledVector(front,-4.5).addScaledVector(side,6.2);d.camera.position.y+=1.7;d.controls.target.copy(p);d.controls.target.y+=.25;d.controls.update();return true})()`);
await sleep(100);await screenshot('drive-native-wheels-chase');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,r=d.drive.packedCar;r.updateMatrixWorld(true);const box=new d.THREE.Box3().setFromObject(r),p=box.getCenter(new d.THREE.Vector3()),q=r.getWorldQuaternion(new d.THREE.Quaternion()),front=new d.THREE.Vector3(0,0,1).applyQuaternion(q),side=new d.THREE.Vector3(1,0,0).applyQuaternion(q);d.camera.position.copy(p).addScaledVector(front,6.5).addScaledVector(side,4.5);d.camera.position.y+=2.1;d.controls.target.copy(p);d.controls.target.y+=.45;d.controls.update();return true})()`);
await sleep(100);await screenshot('vehicle-player-lights');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;d.driveCamera.userRotating=false;return true})()`);
const wheelMapping=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.map(({node,pivot})=>({node:node.name,pivot:pivot.name}))`);
const wheelLayout=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,car=d.drive.packedCar;car.updateMatrixWorld(true);let body=null;car.traverse(o=>{if(!body&&o.isMesh&&/NormalCar1_Cube/i.test(o.name||""))body=o});const bb=new d.THREE.Box3().setFromObject(body),out=d.drive.objWheels.map(w=>{const wb=new d.THREE.Box3().setFromObject(w.node),c=wb.getCenter(new d.THREE.Vector3()),l=car.worldToLocal(c.clone());return{name:w.node.name,scale:[w.pivot.scale.x,w.pivot.scale.y,w.pivot.scale.z],local:[l.x,l.y,l.z],box:wb.getSize(new d.THREE.Vector3()).toArray()}});return{body:bb.getSize(new d.THREE.Vector3()).toArray(),wheels:out}})()`);
for(const w of wheelLayout.wheels){if(w.scale.some(v=>!Number.isFinite(v)||v<.9||v>1.1))throw new Error("Drive native wheel scale drifted: "+JSON.stringify(wheelLayout));if(Math.abs(w.local[0])>1.02||Math.abs(w.local[2])>1.85||w.local[1]<-.1||w.local[1]>.8)throw new Error("Drive wheel detached from body: "+JSON.stringify(wheelLayout));}
const byName=Object.fromEntries(wheelLayout.wheels.map(w=>[w.name,w.local]));
const frontLeft=byName["NormalCar1_FrontLeftWheel_Cube.007"], frontRight=byName["NormalCar1_FrontRightWheel_Cube.008"], rearAxle=byName["NormalCar1_BackWheels_Cube.011"];
if(!(frontLeft?.[2]>.5&&frontRight?.[2]>.5&&frontLeft?.[0]>.2&&frontRight?.[0]<-.2&&rearAxle?.[2]<-.5))throw new Error("Drive native front/rear wheel semantics are inverted: "+JSON.stringify(wheelLayout));
if(Math.hypot(frontLeft[0]-rearAxle[0],frontLeft[2]-rearAxle[2])<1.6)throw new Error("Drive front-left wheel is too close to the rear axle: "+JSON.stringify(wheelLayout));
console.log("DRIVE WHEEL LAYOUT",JSON.stringify(wheelLayout));
if(wheelMapping.length!==3||!wheelMapping.some(w=>/FrontLeftWheel/i.test(w.node))||!wheelMapping.some(w=>/FrontRightWheel/i.test(w.node))||!wheelMapping.some(w=>/BackWheels/i.test(w.node)))throw new Error('native wheel groups were not mapped: '+JSON.stringify(wheelMapping));
const wheelBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.map(({pivot})=>({x:pivot.rotation.x,y:pivot.rotation.y}))`);
const wheelContinuousBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.map(({pivot})=>pivot.rotation.x)`);
await key('KeyW',false); await key('KeyA',false); await sleep(500);
const wheelAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.map(({pivot})=>({x:pivot.rotation.x,y:pivot.rotation.y}))`);
const wheelContinuousAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.map(({pivot})=>pivot.rotation.x)`);
await key('KeyA'); await key('KeyW');
if(Math.max(...wheelAfter.map((w,i)=>Math.abs(w.x-wheelBefore[i].x)))<.01||Math.max(...wheelContinuousAfter.map((x,i)=>Math.abs(x-wheelContinuousBefore[i])))<.15||Math.abs(wheelAfter[0].y-wheelBefore[0].y)<.01||Math.abs(wheelAfter[1].y-wheelBefore[1].y)<.01)throw new Error(`native wheel visuals did not roll continuously/steer: ${JSON.stringify({wheelMapping,wheelBefore,wheelAfter,wheelContinuousBefore,wheelContinuousAfter})}`);
const wheelMaterials=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.objWheels.flatMap(({node})=>{const out=[];node.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.color&&out.push(m.color.getHexString()))}});return out})`);
if(!wheelMaterials.some(c=>c==='111820'||c==='9aa5b1'))throw new Error(`native wheel materials were not made visible: ${JSON.stringify(wheelMaterials)}`);
console.log('NATIVE WHEELS',JSON.stringify({wheelMapping,wheelBefore,wheelAfter,wheelMaterials}));
await key('KeyD');
await sleep(900);
await ev("(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,p=d.drive.renderPos;d.drive.car.visible=true;d.camera.position.set(p.x,p.y+42,p.z+.01);d.controls.target.set(p.x,p.y,p.z);d.controls.update();return true})()");
await sleep(900);await screenshot('drive-native-wheels-top');
await ev("window.__SC_CAMPUS_MAP_3D__.reset()");
await sleep(600);
await key('KeyD');
const steer=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on`);
if(!steer)throw new Error('second D toggled Drive off');
console.log('DRIVE EASTER EGG',JSON.stringify(drive));

await key('Escape');
await sleep(900);
const afterEsc=await ev(`(()=>({fs:!!document.fullscreenElement,drive:window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on}))()`);
if(afterEsc.fs||afterEsc.drive)throw new Error(`Escape did not leave a non-driving non-fullscreen state: ${JSON.stringify(afterEsc)}`);
console.log('ESCAPE EXIT',JSON.stringify(afterEsc));

await ev(`window.__SC_CAMPUS_MAP_3D__.reset()`);
await sleep(300);

/* Smart Drive chase: the existing Drive physics is reused. Hold forward long
 * enough to move, then verify automatic rear alignment engages. */
await clickSelector('.cm3d-fullscreen'); await sleep(400); await key('KeyD'); await sleep(500);
await key('KeyW',false); await sleep(1600);
const moving=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const p=d.drive.body.linvel();return{speed:Math.hypot(p.x,p.z),chase:d.driveCamera.chaseStrength,rotating:d.driveCamera.userRotating}})()`);
const cameraFinite=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,a=d.drive.anchor,p=d.camera.position,t=d.controls.target;const vals=[p.x,p.y,p.z,t.x,t.y,t.z,a.x,a.y,a.z];return{finite:vals.every(Number.isFinite),targetGap:t.distanceTo(a),distance:d.driveCamera.distance}})()`);
if(!cameraFinite.finite||cameraFinite.targetGap>8||!Number.isFinite(cameraFinite.distance))throw new Error("Drive camera state became unstable: "+JSON.stringify(cameraFinite));
console.log("DRIVE CAMERA FINITE",JSON.stringify(cameraFinite));
await key('KeyW');
if(moving.speed<0.5||moving.rotating||moving.chase<0.2)throw new Error(`smart drive chase did not engage: ${JSON.stringify(moving)}`);
const distanceBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.driveCamera.distance`);
await sleep(700);
const chaseAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.driveCamera.chaseStrength`);
if(chaseAfter<.45)throw new Error(`smart drive chase did not sustain: ${chaseAfter}`);
console.log('SMART DRIVE CHASE',JSON.stringify({moving,distanceBefore,chaseAfter}));
await key('Escape'); await sleep(800);
await ev(`window.__SC_CAMPUS_MAP_3D__.reset()`);
await waitFor(`!window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.cameraTransition`,10000,150);
await sleep(1500);

const idleOverview=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{sel:d.ST.sel,strength:d.interaction.idleStrength,pivot:d.interaction.pivotId,transition:d.interaction.cameraTransition}})()`);
if(idleOverview.sel!==null||idleOverview.pivot!==null||idleOverview.strength<.08||idleOverview.transition)throw new Error(`overview cinematic idle failed: ${JSON.stringify(idleOverview)}`);
console.log('CINEMATIC OVERVIEW',JSON.stringify(idleOverview));

await ev(`window.__SC_CAMPUS_MAP_3D__.focus('H')`);
await waitFor(`!window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.cameraTransition`,10000,150);
await sleep(1500);
const idleSelected=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{sel:d.ST.sel,strength:d.interaction.idleStrength,pivot:d.interaction.pivotId,transition:d.interaction.cameraTransition,route:d.R.grp.visible}})()`);
if(idleSelected.sel!=='H'||idleSelected.pivot!=='H'||idleSelected.strength<.08||idleSelected.transition||!idleSelected.route)throw new Error(`selected cinematic idle failed: ${JSON.stringify(idleSelected)}`);
console.log('CINEMATIC SELECTED H',JSON.stringify(idleSelected));

const beforeManual=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.idleStrength`);
const drag=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame,fb=f.getBoundingClientRect();return{x:fb.left+fb.width/2,y:fb.top+fb.height/2}})()`);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',buttons:1,clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+100,y:drag.y+30,button:'left',buttons:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+100,y:drag.y+30,button:'left',buttons:0,clickCount:1});
/* CDP mouse events target the top-level page; mirror the gesture into the
 * same-origin iframe so this regression exercises the real child interaction
 * handler rather than relying on browser-specific iframe event routing. */
await ev(`(()=>{const s=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.document.querySelector('#scene');const o={bubbles:true,clientX:100,clientY:100,buttons:1};s.dispatchEvent(new MouseEvent('mousedown',o));s.dispatchEvent(new MouseEvent('mousemove',{...o,clientX:200,clientY:130}));s.dispatchEvent(new MouseEvent('mouseup',{...o,buttons:0}));})()`);
await sleep(800);
const afterManual=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.interaction.idleStrength`);
if(afterManual>=beforeManual*.65&&afterManual>.18)throw new Error(`manual input did not suppress cinematic idle: ${beforeManual}->${afterManual}`);
console.log('CINEMATIC MANUAL OVERRIDE',JSON.stringify({before:beforeManual,after:afterManual}));

if(errors.length)throw new Error(`browser console errors: ${errors.slice(0,5).join(' | ')}`);
console.log('NO CONSOLE ERRORS');

chrome.kill('SIGKILL');server.close();