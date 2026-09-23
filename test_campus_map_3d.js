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
const framePoint=async(selector,nx=.5,ny=.5)=>ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame,fb=f.getBoundingClientRect(),b=f.contentWindow.document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:fb.left+b.left+b.width*${nx},y:fb.top+b.top+b.height*${ny},w:b.width,h:b.height}})()`);
const joystickTouch=async(x,y,hold=320)=>{
  const c=await framePoint('#driveJoystick',.5,.5),radius=Math.min(c.w,c.h)*.42,id=7;
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:c.x,y:c.y,id,radiusX:8,radiusY:8,force:1}]});
  await sleep(40);
  await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x+x*radius,y:c.y-y*radius,id,radiusX:8,radiusY:8,force:1}]});
  if(hold)await sleep(hold);
  return{center:c,radius,id};
};
const joystickRelease=async()=>send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});


await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?touchtest=1`});

let ready=false;
for(let i=0;i<120&&!ready;i++){await sleep(500);ready=await ev(`!!window.__SC_CAMPUS_MAP_3D__?.ready&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.DavisTwin&&!!window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__`)}
if(!ready)throw new Error('Davis twin did not become ready within 60 seconds');

const boot=await ev(`(()=>{const m=window.__SC_CAMPUS_MAP_3D__,f=m.frame.contentWindow,b=document.querySelector('.cm3d-fullscreen'),u=new URL(m.frame.src);return{ready:m.ready,embed:u.searchParams.get('embed'),touchtest:u.searchParams.get('touchtest'),touchDevice:f.__DAVIS_TWIN_DEBUG__.isTouchDriveDevice,mobileActivateHidden:f.document.querySelector('#mobileDriveActivate').hidden,ids:f.DavisTwin.buildings,chips:document.querySelectorAll('[data-map-chip]').length,fsBtn:!!b,label:b?.getAttribute('aria-label'),buttonRect:b?.getBoundingClientRect().toJSON(),ui:['#title','#panel','#dock','#info','#compass','#hint','#loader','#fatal'].map(s=>[s,getComputedStyle(f.document.querySelector(s)).display==='none'])}})()`);
if(boot.embed!=='1'||boot.touchtest!=='1'||!boot.touchDevice||!boot.mobileActivateHidden||!boot.ready||boot.chips!==6||!boot.fsBtn||boot.label!=='Enter fullscreen'||boot.buttonRect.width>34||boot.buttonRect.height>34||boot.buttonRect.width<30||boot.buttonRect.height<30||boot.ui.some(x=>!x[1]))throw new Error(`boot/UI contract failed: ${JSON.stringify(boot)}`);
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
const postBudget=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,p=d.PT;return{blurDiv:d.postPerf.blurDiv,scene:[p.w,p.h],blur:[p.a.width,p.a.height],dof:d.CU.uDof.value,touch:d.isTouchDriveDevice}})()`);
if(!postBudget.touch||postBudget.blurDiv!==4||postBudget.blur[0]>Math.ceil(postBudget.scene[0]/4)+1||postBudget.blur[1]>Math.ceil(postBudget.scene[1]/4)+1)throw new Error('touch DOF target is not quarter resolution: '+JSON.stringify(postBudget));
console.log('MOBILE POST BUDGET',JSON.stringify(postBudget));
/* Make the close/front/rear/far artifact set explicitly daylight rather than
 * inheriting whatever the wall clock happens to be during CI. */
await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,e=f.document.querySelector('#timeRange');e.value='720';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
await sleep(650);
const dayState=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.night`);
if(dayState>.22)throw new Error('daylight visual pass did not reach day state: '+dayState);
const dofQa=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;d.__qaSavedDof=d.FX.dof;d.FX.dof=.6;return{saved:d.__qaSavedDof,active:d.FX.dof,blurDiv:d.postPerf.blurDiv}})()`);
await sleep(180);
const dofUniform=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.CU.uDof.value`);
if(dofQa.active<.5||dofQa.blurDiv!==4||dofUniform<.5)throw new Error('forced mobile DOF QA did not activate: '+JSON.stringify({dofQa,dofUniform}));
await screenshot('mobile-dof-day-overview');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;d.FX.dof=d.__qaSavedDof;return d.FX.dof})()`);
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
/* Dusk pass catches distance/post-processing artifacts that can be invisible
 * in full day or full night. */
await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,e=f.document.querySelector('#timeRange');e.value='1160';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
await sleep(650);
await frameVehicle('bus',[-38,20,24],'transit-bus-sunset-far');
await frameVehicle('schoolBus',[-38,20,24],'transit-schoolbus-sunset-far');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;if(d.__qaVisibility){for(const [o,vis] of d.__qaVisibility)o.visible=vis;d.__qaVisibility=null;}for(const v of d.transit.vehicles){v.speed=v.key==='bus'?10.5:8.5;v.stopTimer=0;}return true})()`);
const transitBefore=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
await new Promise(r=>setTimeout(r,1200));
const transitAfter=await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.transit.vehicles.map(v=>v.z)`);
if(transitBefore.every((v,i)=>Math.abs(v-transitAfter[i])<.1))throw new Error(`public transport is not moving: ${JSON.stringify({before:transitBefore,after:transitAfter})}`);
console.log('TRANSIT MOTION',JSON.stringify({before:transitBefore,after:transitAfter}));
console.log('BOOT',JSON.stringify(boot));

/* The arterial crossing must be one authored surface, with four correctly
 * oriented signal heads rather than the old pair of overlapping road ribbons. */
const intersection=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,s=d.trafficSignal,m=d.MAIN_INTERSECTION;return{mesh:s.intersection?.name,size:m.size,heads:s.heads.map(h=>({axis:h.axis,yaw:h.group.rotation.y})),posts:s.posts.length,phase:s.phase,ns:s.ns,ew:s.ew,signalDrawCalls:s.drawCalls}})()`);
if(intersection.mesh!=='MainSignalizedIntersection'||intersection.posts!==4||intersection.heads.length!==4||intersection.size<38||intersection.signalDrawCalls>8)throw new Error('main intersection surface/signal batching failed: '+JSON.stringify(intersection));
const expectedHead=[['z',Math.PI],['z',0],['x',-Math.PI/2],['x',Math.PI/2]];
intersection.heads.forEach((h,i)=>{if(h.axis!==expectedHead[i][0]||Math.abs(Math.atan2(Math.sin(h.yaw-expectedHead[i][1]),Math.cos(h.yaw-expectedHead[i][1])))>.01)throw new Error('traffic signal head faces the wrong approach: '+JSON.stringify(intersection));});
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,m=d.MAIN_INTERSECTION;d.setTrafficSignalPhase('ns-green');d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.camera.position.set(m.x+48,58,m.z+52);d.controls.target.set(m.x,0,m.z);d.controls.update();return true})()`);await sleep(250);await screenshot('main-intersection-day-top');
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,m=d.MAIN_INTERSECTION;d.camera.position.set(m.x+2,7,m.z-49);d.controls.target.set(m.x,3.1,m.z);d.controls.update();return true})()`);await sleep(220);await screenshot('main-intersection-signals');

/* Existing non-Drive traffic must obey the signal too. Put one northbound car
 * just before the south stop line, hold its axis red, then release it on green. */
const signalNpcSetup=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,c=d.traffic.cars.find(c=>c.ax==='z'&&c.d>0),stop=d.MAIN_INTERSECTION.stop.southZ,coord=stop-7;c.t=(coord+320)/640;c.signalV=c.v;d.setTrafficSignalPhase('ew-green');return{base:c.v,stop,coord,index:d.traffic.cars.indexOf(c)}})()`);
await sleep(900);
const signalNpcRed=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,c=d.traffic.cars[${signalNpcSetup.index}],dist=d.signalDistanceForEntity(c,c.z);return{speed:c.signalV,base:c.v,z:c.z,dist,phase:d.trafficSignal.phase}})()`);
if(signalNpcRed.phase!=='ew-green'||signalNpcRed.speed>=signalNpcRed.base*.8||signalNpcRed.dist<-.7)throw new Error('NPC failed to slow/hold for a red traffic light: '+JSON.stringify({signalNpcSetup,signalNpcRed}));
await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.setTrafficSignalPhase('ns-green')`);await sleep(900);
const signalNpcGreen=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,c=d.traffic.cars[${signalNpcSetup.index}];return{speed:c.signalV,base:c.v,phase:d.trafficSignal.phase}})()`);
if(signalNpcGreen.phase!=='ns-green'||signalNpcGreen.speed<=signalNpcRed.speed+.4)throw new Error('NPC did not resume after its traffic light turned green: '+JSON.stringify({signalNpcRed,signalNpcGreen}));
console.log('SIGNALIZED INTERSECTION/NPC COMPLIANCE',JSON.stringify({intersection,signalNpcRed,signalNpcGreen}));

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
  return ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;const r=${kind==='traffic'?'d.traffic.cars[0].lightRig':"d.transit.vehicles.find(v=>v.key==='bus').lightRig"},p=r.root.getWorldPosition(new d.THREE.Vector3());d.Tw.kill(d.camera.position);d.Tw.kill(d.controls.target);d.interaction.cameraTransition=false;d.interaction.lastInput=performance.now();d.interaction.idleStrength=0;d.interaction.targetStrength=0;d.camera.position.set(p.x+5,p.y+3,p.z+5);d.controls.target.copy(p);d.controls.update();d.refreshVehicleLightBudget();r.dynamicEnabled=true;d.updateVehicleLighting(0,performance.now());return{head:r.headLights.map(l=>({i:l.intensity,v:l.visible})),tail:r.tailLights.map(l=>({i:l.intensity,v:l.visible}))}})()`);
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
const mobileFsUi=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,d=f.__DAVIS_TWIN_DEBUG__,a=f.document.querySelector('#mobileDriveActivate'),j=f.document.querySelector('#driveJoystick');return{touch:d.isTouchDriveDevice,activateHidden:a.hidden,joystickHidden:j.hidden,activateRect:a.getBoundingClientRect().toJSON()}})()`);
if(!mobileFsUi.touch||mobileFsUi.activateHidden||!mobileFsUi.joystickHidden||mobileFsUi.activateRect.width<44||mobileFsUi.activateRect.height<44)throw new Error('mobile fullscreen Drive affordance failed: '+JSON.stringify(mobileFsUi));
console.log('MOBILE FULLSCREEN ACTIVATE UI',JSON.stringify(mobileFsUi));
await screenshot('mobile-drive-activation');

await clickSelector('.cm3d-fullscreen');
await sleep(500);
fullscreenState=await ev(`(()=>({host:!!document.fullscreenElement,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),overflow:document.body.style.overflow}))()`);
if(fullscreenState.host||fullscreenState.label!=='Enter fullscreen'||fullscreenState.overflow!=='')throw new Error(`fullscreen exit button failed: ${JSON.stringify(fullscreenState)}`);
const mobileAfterExit=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow;return{activateHidden:f.document.querySelector('#mobileDriveActivate').hidden,joystickHidden:f.document.querySelector('#driveJoystick').hidden,touch:f.__DAVIS_TWIN_DEBUG__.drive.touch}})()`);
if(!mobileAfterExit.activateHidden||!mobileAfterExit.joystickHidden||mobileAfterExit.touch.active||mobileAfterExit.touch.x||mobileAfterExit.touch.y)throw new Error('mobile controls did not clean up on fullscreen exit: '+JSON.stringify(mobileAfterExit));
console.log('FULLSCREEN EXIT BUTTON',JSON.stringify({...fullscreenState,mobileAfterExit}));

await clickSelector('.cm3d-fullscreen');
await sleep(400);
const mobileBeforeDrive=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow;return{activateHidden:f.document.querySelector('#mobileDriveActivate').hidden,joystickHidden:f.document.querySelector('#driveJoystick').hidden}})()`);
if(mobileBeforeDrive.activateHidden||!mobileBeforeDrive.joystickHidden)throw new Error('mobile activation control missing before Drive: '+JSON.stringify(mobileBeforeDrive));
await clickSelectorInFrame('#mobileDriveActivate');
await waitFor(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return d.drive.on&&!!d.drive.packedCar&&d.drive.npcPhysics.ready})()`,16000,150);
const mobileDriveUi=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,j=f.document.querySelector('#driveJoystick'),a=f.document.querySelector('#mobileDriveActivate'),r=j.getBoundingClientRect();return{activateHidden:a.hidden,joystickHidden:j.hidden,size:[r.width,r.height],opacity:getComputedStyle(j).opacity}})()`);
if(!mobileDriveUi.activateHidden||mobileDriveUi.joystickHidden||mobileDriveUi.size[0]<88||mobileDriveUi.size[0]>155)throw new Error('mobile joystick visibility/size failed: '+JSON.stringify(mobileDriveUi));
console.log('MOBILE DRIVE ACTIVATED',JSON.stringify(mobileDriveUi));
const mobileDrivePerf=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,roots=d.traffic.set.roots,pc=d.traffic.parkedCount,save=d.drive.renderPos.clone();d.refreshVehicleLightBudget();const dynamic=d.traffic.cars.filter(c=>c.lightRig?.dynamicEnabled).length+(d.transit?.vehicles||[]).filter(v=>v.lightRig?.dynamicEnabled).length;d.drive.renderPos.set(d.MAIN_INTERSECTION.x,0,d.MAIN_INTERSECTION.z);d.updateDriveTrafficLod();const atIntersection={parked:roots.slice(0,pc).filter(r=>r.visible).length,moving:roots.slice(pc).filter(r=>r.visible).length};d.drive.renderPos.copy(save);d.updateDriveTrafficLod();return{parked:pc,frozen:roots.slice(0,pc).filter(r=>!r.matrixAutoUpdate).length,dynamic,atIntersection,lod:{parked:Math.sqrt(d.drivePerf.parkedLodSq),moving:Math.sqrt(d.drivePerf.movingLodSq),transit:Math.sqrt(d.drivePerf.transitLodSq)}}})()`);
if(mobileDrivePerf.frozen!==mobileDrivePerf.parked||mobileDrivePerf.dynamic>1||mobileDrivePerf.atIntersection.parked>=mobileDrivePerf.parked||mobileDrivePerf.lod.parked>170||mobileDrivePerf.lod.moving<250)throw new Error('mobile Drive performance budget regressed: '+JSON.stringify(mobileDrivePerf));
console.log('MOBILE DRIVE PERFORMANCE BUDGET',JSON.stringify(mobileDrivePerf));

const touchMove=await joystickTouch(.72,.92,520);
const touchState=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,i=d.readDriveInput(),v=d.drive.body.linvel();return{touch:{...d.drive.touch},input:i,speed:Math.hypot(v.x,v.z),steer:d.drive.steer,tune:d.DRIVE_TUNE}})()`);
if(!touchState.touch.active||touchState.input.source!=='touch'||touchState.input.throttle<.78||touchState.input.turn>-.62||touchState.speed<3||touchState.steer>-.25)throw new Error('joystick diagonal throttle/steering is still too weak: '+JSON.stringify(touchState));
if(touchState.tune.maxForward<36||touchState.tune.maxSteer<.55||touchState.tune.yawGain<2.6)throw new Error('Drive speed/turning tune regressed: '+JSON.stringify(touchState.tune));
const multiTouch=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,d=f.__DAVIS_TWIN_DEBUG__,j=f.document.querySelector('#driveJoystick'),r=j.getBoundingClientRect(),before={...d.drive.touch};j.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:99,pointerType:'touch',clientX:r.right-5,clientY:r.bottom-5}));j.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:99,pointerType:'touch',clientX:r.left+5,clientY:r.top+5}));return{before,after:{...d.drive.touch}}})()`);
if(multiTouch.after.pointerId!==multiTouch.before.pointerId||Math.abs(multiTouch.after.x-multiTouch.before.x)>.001||Math.abs(multiTouch.after.y-multiTouch.before.y)>.001)throw new Error('second touch stole joystick control: '+JSON.stringify(multiTouch));
await screenshot('mobile-drive-joystick-active');
await joystickRelease();await sleep(120);
const touchReleased=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,d=f.__DAVIS_TWIN_DEBUG__,t=d.drive.touch,thumb=f.document.querySelector('#driveJoystickThumb');return{active:t.active,x:t.x,y:t.y,pointer:t.pointerId,thumb:thumb.style.transform}})()`);
if(touchReleased.active||touchReleased.pointer!==null||Math.abs(touchReleased.x)>.001||Math.abs(touchReleased.y)>.001||!touchReleased.thumb.includes('-50%'))throw new Error('joystick release left stuck input: '+JSON.stringify(touchReleased));
await joystickTouch(-.65,.15,60);await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await sleep(80);
const touchCancelled=await ev(`(()=>{const t=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.touch;return{active:t.active,x:t.x,y:t.y,pointer:t.pointerId}})()`);
if(touchCancelled.active||touchCancelled.pointer!==null||touchCancelled.x||touchCancelled.y)throw new Error('pointer cancellation left stuck joystick input: '+JSON.stringify(touchCancelled));
await joystickTouch(.2,.7,50);await ev(`window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.dispatchEvent(new Event('resize'))`);await sleep(80);
const resizeReset=await ev(`(()=>{const t=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.touch;return{active:t.active,x:t.x,y:t.y,pointer:t.pointerId}})()`);
await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
if(resizeReset.active||resizeReset.pointer!==null||resizeReset.x||resizeReset.y)throw new Error('resize/orientation cleanup failed: '+JSON.stringify(resizeReset));
console.log('MOBILE JOYSTICK INPUT/CLEANUP',JSON.stringify({touchState,touchReleased,touchCancelled,resizeReset}));
let drive=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{on:d.drive.on,fs:d.actualFullscreen(),keys:{d:d.drive.keys.d},distance:d.driveCamera?.distance,packed:!!d.drive.packedCar,npcBodies:d.drive.npcPhysics.bodies.length,npcCreated:d.drive.npcPhysics.created}})()`);
if(!drive.on||!drive.fs||!drive.packed||drive.npcBodies<14||drive.npcCreated!==drive.npcBodies)throw new Error(`fullscreen Drive/NPC physics failed: ${JSON.stringify({drive,errors})}`);
const playerCollider=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{visual:d.drive.nativeVisualSize,collider:d.drive.colliderSize}})()`);
if(!playerCollider.visual||!playerCollider.collider||Math.abs(playerCollider.collider.width/playerCollider.visual[0]-.92)>.08||Math.abs(playerCollider.collider.length/playerCollider.visual[2]-.92)>.08)throw new Error('player collider is stale or mismatched to the native car: '+JSON.stringify(playerCollider));
console.log('PLAYER COLLIDER FROM NATIVE MODEL',JSON.stringify(playerCollider));
const npcColliders=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return d.drive.npcPhysics.bodies.map(a=>({kind:a.kind,size:a.size,halfWidth:a.halfWidth,halfLength:a.halfLength,finite:[a.body.translation().x,a.body.translation().y,a.body.translation().z,a.body.linvel().x,a.body.linvel().y,a.body.linvel().z].every(Number.isFinite)}))})()`);
if(npcColliders.length<14||npcColliders.some(a=>!a.finite||a.halfWidth<.6||a.halfLength<1.5||a.halfLength<a.halfWidth))throw new Error('NPC colliders do not match vehicle footprints: '+JSON.stringify(npcColliders));
console.log('NPC PHYSICS COLLIDERS',JSON.stringify(npcColliders));

/* The same signal rule must govern Rapier NPCs during Drive mode. */
const physicsSignal=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars.find(c=>c.ax==='z'&&c.d>0).physics,e=ai.entity,stop=d.MAIN_INTERSECTION.stop.southZ,p=ai.body.translation(),b=d.drive.body;d.__qaSignal={p:ai.body.translation(),r:ai.body.rotation(),v:ai.body.linvel(),player:b.translation(),playerV:b.linvel()};ai.body.setTranslation({x:e.f,y:p.y,z:stop-4.5},true);ai.body.setLinvel({x:0,y:0,z:6},true);b.setTranslation({x:120,y:1.2,z:120},true);b.setLinvel({x:0,y:0,z:0},true);d.setTrafficSignalPhase('ew-green');const red=d.trafficSignalSpeedLimit(e,stop-4.5,6,ai.baseSpeed);d.updateNpcPhysicsStep(1/60);const redTarget=ai.targetSpeed;d.setTrafficSignalPhase('ns-green');const green=d.trafficSignalSpeedLimit(e,stop-4.5,6,ai.baseSpeed);const q=d.__qaSignal;ai.body.setTranslation(q.p,true);ai.body.setRotation(q.r,true);ai.body.setLinvel(q.v,true);b.setTranslation(q.player,true);b.setLinvel(q.playerV,true);return{red,redTarget,green,base:ai.baseSpeed}})()`);
if(physicsSignal.red>=physicsSignal.base*.75||physicsSignal.redTarget>physicsSignal.red+.2||Math.abs(physicsSignal.green-physicsSignal.base)>.01)throw new Error('Rapier NPC signal compliance failed: '+JSON.stringify(physicsSignal));
console.log('RAPIER NPC SIGNAL COMPLIANCE',JSON.stringify(physicsSignal));

/* Predictive NPC avoidance: a player directly in the lane must produce
 * braking/avoidance, while the same player well beside the lane must not. */
const npcScenario=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[0].physics,rf=d.routeFrame(ai),p=ai.body.translation(),b=d.drive.body;d.__qaPlayer={p:b.translation(),r:b.rotation(),v:b.linvel(),w:b.angvel()};d.__qaNpc={p:ai.body.translation(),r:ai.body.rotation(),v:ai.body.linvel(),base:ai.baseSpeed};b.setTranslation({x:p.x+rf.fx*10,y:1.2,z:p.z+rf.fz*10},true);b.setLinvel({x:0,y:0,z:0},true);b.setAngvel({x:0,y:0,z:0},true);ai.body.setLinvel({x:rf.fx*ai.baseSpeed,y:0,z:rf.fz*ai.baseSpeed},true);return{base:ai.baseSpeed,rf,p:[p.x,p.y,p.z]}})()`);
await sleep(650);
const avoidState=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[0].physics,v=ai.body.linvel(),p=ai.body.translation(),rf=d.routeFrame(ai);d.camera.position.set(p.x-rf.fx*13+rf.rx*9,p.y+6,p.z-rf.fz*13+rf.rz*9);d.controls.target.set(p.x,p.y+1,p.z);d.controls.update();return{urgency:ai.urgency,target:ai.targetSpeed,base:ai.baseSpeed,side:ai.avoidSide,offset:ai.targetOffset,speed:Math.hypot(v.x,v.z)}})()`);
if(avoidState.urgency<.18||avoidState.target>=avoidState.base*.92)throw new Error('NPC failed predictive braking/avoidance for player in lane: '+JSON.stringify(avoidState));
await screenshot('npc-predictive-avoidance');

await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[0].physics,rf=d.routeFrame(ai),p=ai.body.translation(),b=d.drive.body;b.setTranslation({x:p.x+rf.fx*7+rf.rx*10,y:1.2,z:p.z+rf.fz*7+rf.rz*10},true);b.setLinvel({x:0,y:0,z:0},true);return true})()`);await sleep(1250);
const sideSafe=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[0].physics;return{urgency:ai.urgency,target:ai.targetSpeed,base:ai.baseSpeed,offset:ai.targetOffset}})()`);
if(sideSafe.urgency>.08||sideSafe.target<sideSafe.base*.7)throw new Error('NPC swerved/braked for a player safely beside the road: '+JSON.stringify(sideSafe));
console.log('NPC TRAJECTORY AVOIDANCE',JSON.stringify({avoidState,sideSafe}));

/* High-speed contact uses Rapier CCD on both bodies. Hold one NPC stationary,
 * send the player into it, and require finite state + transferred momentum. */
const collisionSetup=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[1].physics,rf=d.routeFrame(ai),p=ai.body.translation(),b=d.drive.body;d.__qaCollisionBase=ai.baseSpeed;ai.baseSpeed=0;ai.targetSpeed=0;ai.body.setLinvel({x:0,y:0,z:0},true);ai.body.setAngvel({x:0,y:0,z:0},true);const gap=ai.halfLength+(d.drive.colliderSize?.length*.5||d.TRAFFIC_AI.playerHalfLength)+.45;/* Put both chassis on the same physics ground plane. The player collider is offset upward from its rigid-body origin; y=1.2 would suspend it above the NPC collider and test visual overlap instead of physical contact. */b.setTranslation({x:p.x-rf.fx*gap,y:p.y,z:p.z-rf.fz*gap},true);b.setRotation({x:0,y:Math.sin(Math.atan2(rf.fx,rf.fz)/2),z:0,w:Math.cos(Math.atan2(rf.fx,rf.fz)/2)},true);b.setLinvel({x:rf.fx*25,y:0,z:rf.fz*25},true);b.setAngvel({x:0,y:0,z:0},true);return{gap,base:d.__qaCollisionBase,y:p.y}})()`);
await sleep(700);
const collisionState=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,ai=d.traffic.cars[1].physics,p=ai.body.translation(),pv=d.drive.body.translation(),v=ai.body.linvel(),dv=d.drive.body.linvel(),vals=[p.x,p.y,p.z,pv.x,pv.y,pv.z,v.x,v.y,v.z,dv.x,dv.y,dv.z];return{finite:vals.every(Number.isFinite),npcSpeed:Math.hypot(v.x,v.z),playerSpeed:Math.hypot(dv.x,dv.z),separation:Math.hypot(p.x-pv.x,p.z-pv.z),recoveries:d.drive.npcPhysics.recoveries}})()`);
if(!collisionState.finite||collisionState.npcSpeed<.25||collisionState.separation<1.5||collisionState.playerSpeed>40)throw new Error('high-speed player/NPC collision was unstable or transferred no momentum: '+JSON.stringify(collisionState));
await screenshot('npc-player-collision');
console.log('NPC COLLISION RESPONSE',JSON.stringify({collisionSetup,collisionState}));
await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__,a=d.traffic.cars[1].physics;a.baseSpeed=d.__qaCollisionBase;d.resetNpcPhysicsFromRoutes();const q=d.__qaPlayer,b=d.drive.body;if(q){b.setTranslation(q.p,true);b.setRotation(q.r,true);b.setLinvel(q.v,true);b.setAngvel(q.w,true);}return true})()`);await sleep(160);

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
const mobileAfterEscape=await ev(`(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow,d=f.__DAVIS_TWIN_DEBUG__;return{activateHidden:f.document.querySelector('#mobileDriveActivate').hidden,joystickHidden:f.document.querySelector('#driveJoystick').hidden,touch:{...d.drive.touch},npcCreated:d.drive.npcPhysics.created,npcBodies:d.drive.npcPhysics.bodies.length}})()`);
if(!mobileAfterEscape.activateHidden||!mobileAfterEscape.joystickHidden||mobileAfterEscape.touch.active||mobileAfterEscape.npcCreated!==mobileAfterEscape.npcBodies)throw new Error('Drive cleanup/physics reuse failed: '+JSON.stringify(mobileAfterEscape));
console.log('ESCAPE EXIT',JSON.stringify({afterEsc,mobileAfterEscape}));

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

const finalPhysics=await ev(`(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{created:d.drive.npcPhysics.created,bodies:d.drive.npcPhysics.bodies.length,recoveries:d.drive.npcPhysics.recoveries,finite:d.drive.npcPhysics.bodies.every(a=>{const p=a.body.translation(),v=a.body.linvel();return[p.x,p.y,p.z,v.x,v.y,v.z].every(Number.isFinite)})}})()`);
if(finalPhysics.created!==finalPhysics.bodies||finalPhysics.bodies<14||!finalPhysics.finite||finalPhysics.recoveries>8)throw new Error('NPC physics leaked/duplicated, became non-finite, or entered a recovery loop: '+JSON.stringify(finalPhysics));
console.log('NPC PHYSICS LIFECYCLE',JSON.stringify(finalPhysics));
if(errors.length)throw new Error(`browser console errors: ${errors.slice(0,5).join(' | ')}`);
console.log('NO CONSOLE ERRORS');

chrome.kill('SIGKILL');server.close();