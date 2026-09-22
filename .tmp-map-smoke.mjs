import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server=spawn('python3',['-m','http.server','8787','--bind','127.0.0.1'],{stdio:'ignore'});
try{
 const browser=await chromium.launch({headless:true,args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
 const errs=[]; page.on('pageerror',e=>errs.push('pageerror: '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
 await page.goto('http://127.0.0.1:8787/index.html?map-smoke=assetfix',{waitUntil:'domcontentloaded'});
 const end=Date.now()+30000; let s=null;
 while(Date.now()<end){
   s=await page.evaluate(()=>{const m=window.__SC_CAMPUS_MAP_3D__,w=m?.frame?.contentWindow,d=w?.__DAVIS_TWIN_DEBUG__;return{
     ready:!!m?.ready,twin:!!w?.DavisTwin,scene:d?.scene?.children?.length||0,calls:d?.renderer?.info?.render?.calls||0,
     car:d?.ASSET_STATE?.car,bus:d?.ASSET_STATE?.transit?.bus,schoolBus:d?.ASSET_STATE?.transit?.schoolBus,
     traffic:d?.traffic?.mode||null,transit:d?.transit?.vehicles?.length||0
   }});
   if(s?.ready&&s.twin&&s.scene>5&&s.calls>0&&s.car==='loaded'&&s.bus==='loaded'&&s.schoolBus==='loaded'&&s.traffic==='packed'&&s.transit===2)break;
   await page.waitForTimeout(500);
 }
 if(!s?.ready||!s?.twin||s.scene<=5||s.calls<=0)throw new Error('map boot/render failed: '+JSON.stringify(s));
 if(s.car!=='loaded'||s.bus!=='loaded'||s.schoolBus!=='loaded'||s.traffic!=='packed'||s.transit!==2)throw new Error('asset integration failed: '+JSON.stringify(s));
 const dims=await page.evaluate(()=>{const f=window.__SC_CAMPUS_MAP_3D__.frame;return {w:f.clientWidth,h:f.clientHeight}});
 if(dims.w<500||dims.h<400)throw new Error('map dimensions invalid: '+JSON.stringify(dims));

 await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.DavisTwin.drive());
 const driveDeadline=Date.now()+12000; let driveState=null;
 while(Date.now()<driveDeadline){
   driveState=await page.evaluate(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__; return {on:!!d?.drive?.on,packed:!!d?.drive?.packedCar,visible:!!d?.drive?.packedCar?.visible}});
   if(driveState.on&&driveState.packed)break;
   await page.waitForTimeout(250);
 }
 if(!driveState?.on||!driveState?.packed)throw new Error('packed drive car did not initialize: '+JSON.stringify(driveState));
 const carBounds=await page.evaluate(()=>{
   const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;
   const box=new d.THREE.Box3().setFromObject(d.drive.packedCar), size=box.getSize(new d.THREE.Vector3()), center=box.getCenter(new d.THREE.Vector3());
   return {size:{x:size.x,y:size.y,z:size.z},center:{x:center.x,y:center.y,z:center.z}};
 });
 const horizontal=Math.max(carBounds.size.x,carBounds.size.z), vertical=carBounds.size.y;
 if(horizontal<2.0||horizontal>7.5||vertical<0.45||vertical>2.5)throw new Error('packed car dimensions invalid: '+JSON.stringify(carBounds));
 await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.DavisTwin.drive());
 await page.waitForTimeout(350);
 await page.locator('.cm3d-mount').screenshot({path:'/tmp/davis-assetfix.png'});
 console.log('ASSET MAP PASS',JSON.stringify({s,dims,driveState,carBounds,errs}));
 if(errs.length)throw new Error(errs.join(' | '));
 await browser.close();
}finally{server.kill('SIGTERM')}