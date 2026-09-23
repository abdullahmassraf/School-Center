/* Davis Campus twin adapter. Keeps the legacy CampusMap3DManager contract while
 * isolating the new Three.js scene in a same-origin iframe. */
const TWIN_URL = new URL('../campus-twin.html', import.meta.url);
const IDS = new Set(['J','H','M','B','C','A']);
const WEATHER = new Set(['clear','cloudy','overcast','rain','snow','fog','live']);
const idOf = v => v == null ? null : (IDS.has(String(v).toUpperCase()) ? String(v).toUpperCase() : null);
const weatherOf = v => WEATHER.has(String(v)) ? String(v) : null;
const fullscreenSvg = (active) => active
  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>'
  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

const ICONS = {
  clear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cloudy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 16.7M6 19h11.5"/></svg>',
  overcast:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 16a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 13.7M5 19h13M7 22h9"/></svg>',
  fog:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M6 13h13M4 17h14"/></svg>',
  rain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 10.7M8 15l-1.5 3M13 15l-1.5 3M18 15l-1.5 3"/></svg>',
  snow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 6.5l14 11M19 6.5l-14 11"/></svg>'
};

export class CampusMap3DManager {
  constructor(mount, opts={}) {
    if (!mount) throw new Error('CampusMap3DManager: mount element is required');
    this.mount=mount; this.opts=opts; this.disposed=false; this.ready=false;
    this.focusId=null; this.camMode='overview'; this._listeners=new Set(); this._queue=[];
    this._origin=location.origin; this._routeVisible=false; this._weatherCondition='clear';
    this.fullscreenRoot=mount.closest('#cm-stage-3d')||mount;
    this._weatherTemp=null; this.autoOrbit=!matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const q=new URLSearchParams({embed:'1',autoorbit:this.autoOrbit?'1':'0'});
    for(const [k,v] of Object.entries({building:idOf(opts.building),weather:weatherOf(opts.weather),season:opts.season,quality:opts.quality,time:opts.time})) if(v!=null) q.set(k,String(v));
    if(location.hostname==='127.0.0.1'||location.hostname==='localhost'){
      q.set('debug','1');
      /* Local-only deterministic touch capability switch for browser QA. It
       * never affects production URLs and lets headless Chromium exercise the
       * exact fullscreen mobile controls without spoofing app architecture. */
      if(new URLSearchParams(location.search).has('touchtest'))q.set('touchtest','1');
    }

    const f=this.frame=document.createElement('iframe');
    f.src=`${TWIN_URL.href}?${q}`; f.title='Interactive 3D map of Davis Campus'; f.loading='eager';
    f.setAttribute('allow','fullscreen'); f.setAttribute('aria-label','Interactive 3D map of Davis Campus');
    Object.assign(f.style,{position:'absolute',inset:'0',width:'100%',height:'100%',border:'0',display:'block',background:'#070914',borderRadius:'inherit'});
    Object.assign(mount.style,{position:'relative'}); mount.replaceChildren(f);
    this._onMessage=e=>{
      if(this.disposed||e.source!==f.contentWindow||e.origin!==this._origin) return;
      const d=e.data; if(!d||d.source!=='davis-twin'||typeof d.type!=='string') return;
      if(d.type==='ready'){this.ready=true;this.refreshAccent();this._post({type:'campus:autoorbit',value:this.autoOrbit});this._post({type:'campus:fullscreen-state',value:document.fullscreenElement===this.fullscreenRoot});for(const m of this._queue.splice(0))this._post(m);this._resolveReady?.(true);this._resolveReady=null;}
      else if(d.type==='select'){const id=idOf(d.id);this.focusId=id;this.camMode=id?'focus':'overview';this._routeVisible=!!id;this.pathBtn?.classList.toggle('is-hidden',!id);this._listeners.forEach(fn=>{try{fn(id)}catch(err){console.error(err)}});}
      else if(d.type==='fullscreen-request'){try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen();else if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen();}catch{}}
      else if(d.type==='weather'){const w=weatherOf(d.value);if(w){this._weatherCondition=w;if(Number.isFinite(Number(d.temp)))this._weatherTemp=Number(d.temp);this._updateWeatherChip();}}
      else if(d.type==='status'&&typeof this.opts.onStatus==='function')this.opts.onStatus(String(d.value));
    };
    addEventListener('message',this._onMessage);
    this._onVisibility=()=>this._post({type:'campus:visibility',value:!document.hidden});
    document.addEventListener('visibilitychange',this._onVisibility);
    this._onFullscreenChange=()=>{
      const active=document.fullscreenElement===this.fullscreenRoot;
      this._syncFullscreenState(active);
      this._post({type:'campus:fullscreen-state',value:active});
      requestAnimationFrame(()=>this._post({type:'campus:resize'}));
      document.documentElement.classList.toggle('cm-map-fullscreen',active);
      if(active){
        if(this._pageOverflowBeforeFullscreen===undefined)this._pageOverflowBeforeFullscreen=document.body.style.overflow;
        document.body.style.overflow='hidden';
      }else{
        /* Chromium can dispatch fullscreenchange before exitFullscreen()'s
         * promise settles. Restore the page synchronously and once more on
         * the next task so an intermediate event cannot leave the app locked. */
        document.body.style.overflow=this._pageOverflowBeforeFullscreen ?? '';
        this._pageOverflowBeforeFullscreen=undefined;
        setTimeout(()=>{
          if(this.disposed||document.fullscreenElement)return;
          document.body.style.overflow='';
        },0);
      }
    };
    document.addEventListener('fullscreenchange',this._onFullscreenChange);
    this._mo=new MutationObserver(()=>this.refreshAccent());
    this._mo.observe(document.documentElement,{attributes:true,attributeFilter:['style','class','data-theme']});
    window.__SC_CAMPUS_MAP_3D__=this;
    this._installLegacyHud();
  }

  async init(){
    if(this.disposed)return false;if(this.ready)return true;
    return new Promise(resolve=>{
      this._resolveReady=resolve;
      this._readyTimeout=setTimeout(()=>{if(!this.ready&&!this.disposed){this._resolveReady=null;resolve(false)}},20000);
      setTimeout(()=>{if(!this.ready&&!this.disposed)this.opts.onStatus?.('3D campus map is taking longer than expected to load.')},10000);
    });
  }

  _post(msg){
    if(this.disposed)return;
    if(!this.ready||!this.frame.contentWindow){this._queue.push(msg);return;}
    try{this.frame.contentWindow.postMessage(msg,this._origin)}catch{}
  }

  _updateWeatherChip(){
    if(!this.weatherChip)return;const c=weatherOf(this.weatherCondition)||'clear';
    this.weatherChip.querySelector('.cm3d-weather-icon').innerHTML=ICONS[c]||ICONS.clear;
    this.weatherChip.querySelector('.cm3d-weather-temp').textContent=this._weatherTemp==null?'—°':`${this._weatherTemp}°`;
    this.weatherChip.dataset.condition=c;
  }

  _syncFullscreenState(active=!!document.fullscreenElement){
    if(!this.fullscreenBtn)return;
    this.fullscreenBtn.innerHTML=fullscreenSvg(active);
    /* The accessible name stays a stable action ("Toggle Fullscreen") so the
     * control reads as one toggle; the live state is exposed via aria-pressed
     * and the title carries the concrete next action. */
    this.fullscreenBtn.setAttribute('aria-label','Toggle Fullscreen');
    this.fullscreenBtn.title=active?'Exit fullscreen':'Enter fullscreen';
    this.fullscreenBtn.setAttribute('aria-pressed',String(active));
  }
  async _toggleFullscreen(){
    this._post({type:'campus:user-interaction'});
    try{
      if(document.fullscreenElement===this.fullscreenRoot){
        if(document.exitFullscreen) await document.exitFullscreen();
      }else if(this.fullscreenRoot?.requestFullscreen){
        await this.fullscreenRoot.requestFullscreen();
      }
    }catch(_){}
    const active=document.fullscreenElement===this.fullscreenRoot;
    this._syncFullscreenState(active);
    if(!active){
      this._pageOverflowBeforeFullscreen=undefined;
      document.body.style.overflow='';
    }
  }

  _installLegacyHud(){
    const hud=document.createElement('div');hud.className='cm3d-hud';
    /* Reset and Fullscreen are one continuous pill with two independent halves.
     * The wayfinding toggle sits beside the pill (it only appears once a
     * building is selected) so the pill always reads as a single widget. */
    hud.innerHTML='<button class="cm3d-path-toggle is-hidden" type="button" title="Toggle wayfinding paths" aria-label="Toggle wayfinding paths"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h4"/></svg></button>'
      +'<div class="cm3d-pill" role="group" aria-label="Map view controls">'
      +'<button class="cm3d-reset" type="button" title="Reset view" aria-label="Reset View"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>'
      +'<span class="cm3d-pill-sep" aria-hidden="true"></span>'
      +'<button class="cm3d-fullscreen" type="button" title="Enter fullscreen" aria-label="Toggle Fullscreen" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>'
      +'</div>';
    this.mount.appendChild(hud);this.resetBtn=hud.querySelector('.cm3d-reset');this.pathBtn=hud.querySelector('.cm3d-path-toggle');this.fullscreenBtn=hud.querySelector('.cm3d-fullscreen');this.pill=hud.querySelector('.cm3d-pill');
    this.fullscreenBtn.onclick=e=>{e.stopPropagation();void this._toggleFullscreen()};this._syncFullscreenState();
    this.resetBtn.onclick=e=>{e.stopPropagation();this.reset()};
    this.pathBtn.onclick=e=>{e.stopPropagation();this._routeVisible=!this._routeVisible;this._post({type:'campus:routeVisible',value:this._routeVisible});this.pathBtn.classList.toggle('is-off',!this._routeVisible)};
    const w=document.createElement('div');w.className='cm3d-weather';w.setAttribute('aria-label','Campus weather');w.innerHTML='<span class="cm3d-weather-icon" aria-hidden="true"></span><span class="cm3d-weather-temp">—°</span>';
    this.mount.appendChild(w);this.weatherChip=w;this._updateWeatherChip();this._removeHud=()=>{hud.remove();w.remove()};
  }

  focus(id){const key=idOf(id);if(!key)return;this.focusId=key;this.camMode='focus';this._routeVisible=true;this.pathBtn?.classList.remove('is-hidden');this._post({type:'campus:select',id:key})}
  showLocation(id){this.focus(id)} showRoute(id){this.focus(id)}
  select(id){id==null?this.reset():this.focus(id)}
  reset(){this.focusId=null;this.camMode='overview';this._routeVisible=false;this.pathBtn?.classList.add('is-hidden');this._post({type:'campus:reset'})}
  autoOrbit(on){this.autoOrbit=Boolean(on)&&!matchMedia?.('(prefers-reduced-motion: reduce)').matches;this._post({type:'campus:autoorbit',value:this.autoOrbit})}
  toggleFullscreen(){return this._toggleFullscreen()}
  resize(){this._post({type:'campus:resize'})}
  refreshAccent(){const value=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();if(value)this._post({type:'campus:accent',value});this._post({type:'campus:theme',value:document.documentElement.dataset.theme||(matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark')})}
  setWeather(value){const v=weatherOf(value);if(!v)return;this._weatherCondition=v;this._updateWeatherChip();this._post({type:'campus:weather',value:v})}
  get weatherCondition(){return this._weatherCondition} set weatherCondition(v){this.setWeather(v)}
  setSeason(v){this._post({type:'campus:season',value:String(v)})}
  setTime(v){if(v==='live')this._post({type:'campus:time',value:'live'});else{const d=new Date(v);if(!Number.isNaN(d.getTime()))this._post({type:'campus:time',value:d.toISOString()})}}
  onSelect(fn){if(typeof fn!=='function')return()=>{};this._listeners.add(fn);return()=>this._listeners.delete(fn)}
  dispose(){if(this.disposed)return;this.disposed=true;this.ready=false;clearTimeout(this._readyTimeout);this._resolveReady?.(false);this._resolveReady=null;removeEventListener('message',this._onMessage);document.removeEventListener('visibilitychange',this._onVisibility);document.removeEventListener('fullscreenchange',this._onFullscreenChange);this._mo?.disconnect();this._removeHud?.();this.frame?.remove();this._queue=[];if(window.__SC_CAMPUS_MAP_3D__===this)delete window.__SC_CAMPUS_MAP_3D__}
  destroy(){this.dispose()}
}
export const mountCampusMap3D=(container,opts)=>new CampusMap3DManager(container,opts);
export const CampusMap3D=CampusMap3DManager;
export default CampusMap3DManager;
