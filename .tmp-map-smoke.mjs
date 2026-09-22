import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const server = spawn('python3',['-m','http.server','8787','--bind','127.0.0.1'],{stdio:'ignore'});
try {
  const browser = await chromium.launch({headless:true,args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
  await page.goto('http://127.0.0.1:8787/index.html?map-smoke=1&debug=1',{waitUntil:'domcontentloaded'});
  const deadline=Date.now()+45000;
  let state=null;
  while(Date.now()<deadline){
    state=await page.evaluate(()=>{
      const m=window.__SC_CAMPUS_MAP_3D__, w=m?.frame?.contentWindow, d=w?.__DAVIS_TWIN_DEBUG__;
      return {managerReady:!!m?.ready,frameReady:!!w?.DavisTwin,ids:w?.DavisTwin?.buildings||[],sceneChildren:d?.scene?.children?.length||0,renderCalls:d?.renderer?.info?.render?.calls||0,assets:d?.ASSET_STATE||null,trafficMode:d?.traffic?.mode||null,transitCount:d?.transit?.vehicles?.length||0};
    });
    if(state.managerReady&&state.frameReady&&state.sceneChildren>5&&state.renderCalls>0) break;
    await page.waitForTimeout(500);
  }
  if(!state?.managerReady||!state?.frameReady||state.sceneChildren<=5||state.renderCalls<=0) throw new Error('map not render-ready: '+JSON.stringify(state));
  for(const id of ['J','H','M','B','C','A']) if(!state.ids.includes(id)) throw new Error('missing building '+id);

  const assetDeadline=Date.now()+12000;
  let assets=null;
  while(Date.now()<assetDeadline){
    assets=await page.evaluate(()=>{const d=window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__;return{car:d?.ASSET_STATE?.car,bus:d?.ASSET_STATE?.transit?.bus,schoolBus:d?.ASSET_STATE?.transit?.schoolBus,traffic:d?.traffic?.mode,transit:d?.transit?.vehicles?.length||0}});
    if(assets.car==='loaded'&&assets.bus==='loaded'&&assets.schoolBus==='loaded'&&assets.traffic==='packed'&&assets.transit===2) break;
    await page.waitForTimeout(250);
  }
  if(!assets||assets.car!=='loaded'||assets.bus!=='loaded'||assets.schoolBus!=='loaded'||assets.traffic!=='packed'||assets.transit!==2)
    throw new Error('asset integration failed: '+JSON.stringify(assets));

  for(const id of ['J','H','M','B','C','A']){
    await page.evaluate(id=>window.__SC_CAMPUS_MAP_3D__.focus(id),id); await page.waitForTimeout(550);
    const picked=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
    if(picked!==id) throw new Error('building selection failed for '+id+': '+picked);
  }
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.reset()); await page.waitForTimeout(300);

  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.focus('H')); await page.waitForTimeout(1200);
  const focused=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
  if(focused!=='H') throw new Error('focus failed');
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.showRoute('H')); await page.waitForTimeout(300);
  const route=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.R.grp.visible);
  if(!route) throw new Error('route failed');
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.reset()); await page.waitForTimeout(300);
  const reset=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.sel);
  if(reset!==null) throw new Error('reset failed');
  await page.evaluate(()=>{document.documentElement.style.setProperty('--accent','#ff4fd8'); window.__SC_CAMPUS_MAP_3D__.refreshAccent();}); await page.waitForTimeout(150);
  const accent=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.accent?.getHexString?.() || null);
  if(accent!=='ff4fd8') throw new Error('accent failed: '+accent);
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setWeather('rain')); await page.waitForTimeout(900);
  const rain=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.W.rain);
  if(!(rain>0)) throw new Error('weather failed');
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.setTime('2026-12-21T21:30:00-05:00')); await page.waitForTimeout(2200);
  const night=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.ST.night);
  if(!(night>0.2)) throw new Error('time failed: '+night);
  await page.locator('.cm3d-fullscreen').click(); await page.waitForTimeout(450);
  const full=await page.evaluate(()=>({root:document.fullscreenElement?.id||null,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label'),width:document.querySelector('#cm-stage-3d')?.getBoundingClientRect().width,height:document.querySelector('#cm-stage-3d')?.getBoundingClientRect().height}));
  if(full.root!=='cm-stage-3d'||full.label!=='Exit fullscreen'||full.width<100||full.height<100)throw new Error('map fullscreen failed: '+JSON.stringify(full));
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true})));
  let driveOn=false; const driveDeadline=Date.now()+12000;
  while(Date.now()<driveDeadline){
    driveOn=await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on);
    if(driveOn) break;
    await page.waitForTimeout(200);
  }
  if(!driveOn)throw new Error('fullscreen Drive activation failed');
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}))); await page.waitForTimeout(700);
  const afterDrive=await page.evaluate(()=>({full:document.fullscreenElement?.id||null,drive:window.__SC_CAMPUS_MAP_3D__.frame.contentWindow.__DAVIS_TWIN_DEBUG__.drive.on}));
  if(afterDrive.drive)throw new Error('Drive Escape exit failed: '+JSON.stringify(afterDrive));
  await page.evaluate(()=>window.__SC_CAMPUS_MAP_3D__.toggleFullscreen()); await page.waitForTimeout(600);
  const outside=await page.evaluate(()=>({full:document.fullscreenElement?.id||null,label:document.querySelector('.cm3d-fullscreen')?.getAttribute('aria-label')}));
  if(outside.full||outside.label!=='Enter fullscreen')throw new Error('fullscreen exit failed: '+JSON.stringify(outside));
  await page.locator('.cm3d-mount').screenshot({path:'/tmp/davis-map-smoke.png'});
  console.log('MAP SMOKE PASS',JSON.stringify({state,assets,focused,route,reset,accent,rain,night,errors}));
  if(errors.length) throw new Error('browser errors: '+errors.join(' | '));
  const mobileErrors=[];
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  mobile.on('pageerror',e=>mobileErrors.push('pageerror: '+e.message));
  mobile.on('console',m=>{if(m.type()==='error')mobileErrors.push('console: '+m.text())});
  await mobile.goto('http://127.0.0.1:8787/index.html?map-smoke=mobile&debug=1',{waitUntil:'domcontentloaded'});
  const mobileDeadline=Date.now()+30000;
  let mobileState=null;
  while(Date.now()<mobileDeadline){
    mobileState=await mobile.evaluate(()=>{const m=window.__SC_CAMPUS_MAP_3D__,d=m?.frame?.contentWindow?.__DAVIS_TWIN_DEBUG__;return{ready:!!m?.ready,scene:!!d?.renderer,children:d?.scene?.children?.length||0,calls:d?.renderer?.info?.render?.calls||0}});
    if(mobileState.ready&&mobileState.scene&&mobileState.children>5&&mobileState.calls>0)break;
    await mobile.waitForTimeout(500);
  }
  if(!mobileState?.ready||mobileState.children<=5||mobileState.calls<=0)throw new Error('mobile map did not render: '+JSON.stringify(mobileState));
  const mobileBox=await mobile.locator('.cm3d-mount').boundingBox();
  if(!mobileBox||mobileBox.width<280||mobileBox.height<250)throw new Error('mobile map sizing failed: '+JSON.stringify(mobileBox));
  if(mobileErrors.length)throw new Error('mobile browser errors: '+mobileErrors.join(' | '));
  console.log('MOBILE MAP PASS',JSON.stringify({mobileState,mobileBox}));
  await mobile.close();

  await browser.close();
} finally { server.kill('SIGTERM'); }
