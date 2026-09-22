import { chromium } from 'playwright';

const browser = await chromium.launch({headless:true,args:[
  '--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage'
]});
const errors=[];
const page = await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
await page.goto('http://127.0.0.1:8787/index.html?debug=1&asset-smoke=1',{waitUntil:'domcontentloaded'});

const deadline=Date.now()+45000;
let state=null;
while(Date.now()<deadline){
  state=await page.evaluate(()=>{
    const m=window.__SC_CAMPUS_MAP_3D__,w=m?.frame?.contentWindow,d=w?.__DAVIS_TWIN_DEBUG__;
    return {
      managerReady:!!m?.ready, twinReady:!!w?.DavisTwin,
      children:d?.scene?.children?.length||0, calls:d?.renderer?.info?.render?.calls||0,
      assets:d?.ASSET_STATE||null, trafficMode:d?.traffic?.mode||null,
      parked:d?.traffic?.parkedCount||0, moving:d?.traffic?.cars?.length||0,
      transit:d?.transit?.vehicles?.length||0, assetMeshStats:d?.assetMeshStats||{}
    };
  });
  if(state.managerReady&&state.twinReady&&state.children>5&&state.calls>0) break;
  await page.waitForTimeout(500);
}
if(!state?.managerReady||!state?.twinReady||state.children<=5||state.calls<=0)
  throw new Error('map did not become render-ready: '+JSON.stringify(state));
for(const id of ['J','H','M','B','C','A']){
  await page.evaluate(id=>window.__SC_CAMPUS_MAP_3D__.focus(id),id);
  await page.waitForTimeout(450);
  const picked=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
  if(picked!==id) throw new Error('building selection failed: '+id+' -> '+picked);
}
await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.reset());
await page.waitForTimeout(250);
const reset=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
if(reset!==null)throw new Error('reset failed: '+reset);

const geometry=await page.evaluate(()=>{
  const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;
  const result={finite:true,largeRadius:[],hugeEdges:[],trafficMeshes:0,driveMeshes:0,visibleVehicleMeshes:0};
  const inspect=(geom,label,limit)=>{
    if(!geom?.attributes?.position)return;
    const p=geom.attributes.position.array;
    for(let i=0;i<p.length;i++)if(!Number.isFinite(p[i]))result.finite=false;
    if(geom.boundingSphere && geom.boundingSphere.radius>limit)result.largeRadius.push({label,r:geom.boundingSphere.radius});
    const sample=Math.min(p.length/3,450);
    for(let i=0;i+8<sample*3;i+=9){
      const ax=p[i],ay=p[i+1],az=p[i+2],bx=p[i+3],by=p[i+4],bz=p[i+5],cx=p[i+6],cy=p[i+7],cz=p[i+8];
      const ab=(bx-ax)**2+(by-ay)**2+(bz-az)**2,bc=(cx-bx)**2+(cy-by)**2+(cz-bz)**2,ca=(ax-cx)**2+(ay-cy)**2+(az-cz)**2;
      if(Math.max(ab,bc,ca)>81)result.hugeEdges.push({label,edge2:Math.max(ab,bc,ca)});
    }
  };
  if(d.traffic?.set?.entries) for(const [i,e] of d.traffic.set.entries.entries()){result.trafficMeshes++;inspect(e.inst.geometry,'traffic-'+i,5);}
  if(d.drive?.packedCar){d.drive.packedCar.traverse(m=>{if(m.isMesh){result.driveMeshes++;if(m.visible)result.visibleVehicleMeshes++;inspect(m.geometry,'drive-'+m.name,5);}});}
  if(d.transit?.vehicles) d.transit.vehicles.forEach((v,i)=>v.root.traverse(m=>{if(m.isMesh)inspect(m.geometry,'transit-'+i+'-'+m.name,11);}));
  return result;
});
if(!geometry.finite||geometry.largeRadius.length||geometry.hugeEdges.length||geometry.trafficMeshes<1||geometry.driveMeshes<1)
  throw new Error('vehicle geometry integrity failed: '+JSON.stringify(geometry));

await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.showRoute('H'));
await page.waitForTimeout(350);
const route=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.R.grp.visible);
if(!route)throw new Error('route failed');

await page.evaluate(()=>{document.documentElement.style.setProperty('--accent','#ff4fd8');window.__SC_CAMPUS_MAP_3D__.refreshAccent();});
await page.waitForTimeout(200);
const accent=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.accent?.getHexString?.()||null);
if(accent!=='ff4fd8')throw new Error('accent failed: '+accent);

await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setWeather('rain'));
await page.waitForTimeout(900);
const rain=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.W.rain);
if(!(rain>0))throw new Error('rain failed: '+rain);

await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setTime('2026-12-21T21:30:00-05:00'));
await page.waitForTimeout(2200);
const night=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.night);
if(!(night>0.2))throw new Error('night failed: '+night);

const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const mobileErrors=[];mobile.on('pageerror',e=>mobileErrors.push('pageerror: '+e.message));mobile.on('console',m=>{if(m.type()==='error')mobileErrors.push('console: '+m.text())});
await mobile.goto('http://127.0.0.1:8787/index.html?debug=1&asset-smoke=mobile',{waitUntil:'domcontentloaded'});
const mobileDeadline=Date.now()+30000;let ms=null;
while(Date.now()<mobileDeadline){
  ms=await mobile.evaluate(()=>{const m=window.__SC_CAMPUS_MAP_3D__,d=m?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__;return{ready:!!m?.ready,renderer:!!d?.renderer,children:d?.scene?.children?.length||0,calls:d?.renderer?.info?.render?.calls||0}});
  if(ms.ready&&ms.renderer&&ms.children>5&&ms.calls>0)break; await mobile.waitForTimeout(500);
}
const mobileBox=await mobile.locator('.cm3d-mount').boundingBox();
if(!ms?.ready||ms.children<=5||ms.calls<=0||!mobileBox||mobileBox.width<280||mobileBox.height<250)
  throw new Error('mobile render failed: '+JSON.stringify({ms,mobileBox,mobileErrors}));
if(errors.length||mobileErrors.length)throw new Error('browser errors: '+errors.concat(mobileErrors).join(' | '));

console.log('PASS',JSON.stringify({state,geometry,route,accent,rain,night,mobile:ms,mobileBox}));
await mobile.close(); await browser.close();