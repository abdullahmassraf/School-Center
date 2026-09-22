import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
const errors=[];
const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
await page.goto('http://127.0.0.1:8787/index.html?debug=1&asset-geometry=1',{waitUntil:'domcontentloaded'});

const deadline=Date.now()+45000; let state;
while(Date.now()<deadline){
  state=await page.evaluate(()=>{const m=window.__SC_CAMPUS_MAP_3D__,w=m?.frame?.contentWindow,d=w?.__DAVIS_TWIN_DEBUG__;return{
    ready:!!m?.ready,twin:!!w?.DavisTwin,children:d?.scene?.children?.length||0,calls:d?.renderer?.info?.render?.calls||0,
    car:d?.ASSET_STATE?.car,bus:d?.ASSET_STATE?.transit?.bus,schoolBus:d?.ASSET_STATE?.transit?.schoolBus,
    traffic:d?.traffic?.mode||null,transit:d?.transit?.vehicles?.length||0
  }});
  if(state.ready&&state.twin&&state.children>5&&state.calls>0)break;
  await page.waitForTimeout(500);
}
if(!state?.ready||!state?.twin||state.children<=5||state.calls<=0)throw new Error('map not ready: '+JSON.stringify(state));

const assetDeadline=Date.now()+12000; let assets=null;
while(Date.now()<assetDeadline){
  assets=await page.evaluate(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{
    car:d?.ASSET_STATE?.car,bus:d?.ASSET_STATE?.transit?.bus,schoolBus:d?.ASSET_STATE?.transit?.schoolBus,
    traffic:d?.traffic?.mode||null,transit:d?.transit?.vehicles?.length||0
  }});
  if(assets.car==='loaded'&&assets.bus==='loaded'&&assets.schoolBus==='loaded'&&assets.traffic==='packed'&&assets.transit===2)break;
  await page.waitForTimeout(300);
}
if(!assets||assets.car!=='loaded'||assets.bus!=='loaded'||assets.schoolBus!=='loaded'||assets.traffic!=='packed'||assets.transit!==2)
  throw new Error('optional vehicle assets did not finish loading: '+JSON.stringify(assets));

const geometry=await page.evaluate(()=>{
  const d=window.__SC_CAMPUS_MAP_3D__?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__;
  const out={finite:true,large:[],thin:[],trafficMeshes:0,driveMeshes:0,transitMeshes:0,visibleDrive:false,badInstanceTransforms:[]};
  const inspect=(g,label,maxR)=>{
    const p=g?.attributes?.position?.array;if(!p)return;
    for(let i=0;i<p.length;i++)if(!Number.isFinite(p[i]))out.finite=false;
    const r=g.boundingSphere?.radius;
    if(Number.isFinite(r)&&r>maxR)out.large.push({label,r});
    for(let i=0;i+8<p.length;i+=9){
      const ax=p[i],ay=p[i+1],az=p[i+2],bx=p[i+3],by=p[i+4],bz=p[i+5],cx=p[i+6],cy=p[i+7],cz=p[i+8];
      const e1=(bx-ax)**2+(by-ay)**2+(bz-az)**2,e2=(cx-bx)**2+(cy-by)**2+(cz-bz)**2,e3=(ax-cx)**2+(ay-cy)**2+(az-cz)**2;
      const mx=Math.max(e1,e2,e3),mn=Math.min(e1,e2,e3);
      if(mx>64||mx>Math.max(mn,1e-9)*250)out.thin.push({label,mx,mn});
    }
  };
  const sampleInstance=(inst,label)=>{
    const T=d.THREE; const m=new T.Matrix4(), p=new T.Vector3(), q=new T.Quaternion(), s=new T.Vector3();
    for(let i=0;i<Math.min(inst.count,80);i++){
      inst.getMatrixAt(i,m);m.decompose(p,q,s);
      if(![p.x,p.y,p.z,s.x,s.y,s.z].every(Number.isFinite)||s.x<0.45||s.x>2.2||s.y<0.45||s.y>2.2||s.z<0.45||s.z>2.2||Math.abs(p.x)>350||Math.abs(p.z)>350||p.y<-1||p.y>3)
        out.badInstanceTransforms.push({label,i,p:[p.x,p.y,p.z],s:[s.x,s.y,s.z]});
    }
  };
  if(d?.traffic?.set?.entries)for(const [i,e] of d.traffic.set.entries.entries()){out.trafficMeshes++;inspect(e.inst.geometry,'traffic-'+i,6);sampleInstance(e.inst,'traffic-'+i);}
  if(d?.drive?.packedCar)d.drive.packedCar.traverse(m=>{if(m.isMesh){out.driveMeshes++;if(m.visible)out.visibleDrive=true;inspect(m.geometry,'drive-'+m.name,6);}});
  if(d?.transit?.vehicles)for(const [i,v] of d.transit.vehicles.entries())v.root.traverse(m=>{if(m.isMesh){out.transitMeshes++;inspect(m.geometry,'transit-'+i+'-'+m.name,14);}});
  return out;
});
if(!geometry.finite||geometry.large.length||geometry.thin.length||geometry.trafficMeshes<1||geometry.driveMeshes<1||geometry.transitMeshes<1||geometry.badInstanceTransforms.length)
  throw new Error('asset geometry integrity failed: '+JSON.stringify(geometry));

for(const id of ['J','H','M','B','C','A']){
  await page.evaluate(id=>window.__SC_CAMPUS_MAP_3D__.focus(id),id); await page.waitForTimeout(450);
  const picked=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
  if(picked!==id)throw new Error('selection failed '+id+' -> '+picked);
}
await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.showRoute('H'));await page.waitForTimeout(250);
if(!await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.R.grp.visible))throw new Error('route failed');
await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.reset());await page.waitForTimeout(250);

await page.evaluate(()=>{document.documentElement.style.setProperty('--accent','#ff4fd8');window.__SC_CAMPUS_MAP_3D__.refreshAccent()});await page.waitForTimeout(200);
const accent=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.accent?.getHexString?.());
if(accent!=='ff4fd8')throw new Error('accent failed: '+accent);
await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setWeather('rain'));await page.waitForTimeout(900);
if(!(await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.W.rain)>0))throw new Error('rain failed');
await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setTime('2026-12-21T21:30:00-05:00'));await page.waitForTimeout(2200);
if(!(await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.night)>0.2))throw new Error('night failed');

await page.locator('.cm3d-mount').screenshot({path:'/tmp/davis-vehicle-fixed.png'});
if(errors.length)throw new Error('browser errors: '+errors.join(' | '));
console.log('VEHICLE GEOMETRY PASS',JSON.stringify({state,geometry}));
await browser.close();