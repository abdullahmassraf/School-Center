/* src/campus-map-3d.js — School Center host adapter for the Davis Campus twin.
 *
 * Public contract intentionally matches the manager consumed by src/campus-map.js:
 *   new CampusMap3DManager(mount, opts)
 *   await manager.init(); manager.focus(id); manager.reset(); manager.resize();
 *   manager.refreshAccent(); manager.dispose(); manager.weatherCondition = ...
 *
 * The renderer lives in /campus-twin.html?embed=1. The twin owns scene state;
 * this adapter owns the host lifecycle, legacy map HUD, and the postMessage boundary.
 */

const TWIN_URL = new URL('../campus-twin.html', import.meta.url);
const BUILDING_IDS = Object.freeze(['J', 'H', 'M', 'B', 'C', 'A']);
const WEATHER_IDS = new Set(['clear', 'cloudy', 'overcast', 'rain', 'snow', 'fog', 'live']);

const WEATHER_ICONS = {
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cloudy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 16.7"/><path d="M6 19h11.5"/></svg>',
  overcast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 16a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 13.7"/><path d="M5 19h13M7 22h9"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h13M4 17h14"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 10.7"/><path d="M8 15l-1.5 3M13 15l-1.5 3M18 15l-1.5 3"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M5 6.5l14 11M19 6.5l-14 11"/><path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2"/></svg>',
};

const validId = id => id == null ? null : BUILDING_IDS.includes(String(id).toUpperCase()) ? String(id).toUpperCase() : null;
const validWeather = v => WEATHER_IDS.has(String(v)) ? String(v) : null;
const sameOrigin = () => location.origin;

export class CampusMap3DManager {
  constructor(mount, opts = {}) {
    if (!mount) throw new Error('CampusMap3DManager: mount element is required');
    this.mount = mount;
    this.opts = opts;
    this.disposed = false;
    this.ready = false;
    this.focusId = null;
    this.camMode = 'overview';
    this.autoOrbit = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.weather = null;
    this._weatherCondition = 'clear';
    this._weatherTemp = null;
    this._queue = [];
    this._listeners = new Set();
    this._expectedOrigin = sameOrigin();
    this._readyTimer = null;
    this._readyTimeout = null;
    this._resolveReady = null;
    this._removeHostHud = null;
    this._routeVisible = false;

    const q = new URLSearchParams({ embed: '1' });
    if (opts.building) q.set('building', validId(opts.building) || '');
    if (opts.weather && validWeather(opts.weather)) q.set('weather', opts.weather);
    if (opts.season) q.set('season', String(opts.season));
    if (opts.quality) q.set('quality', String(opts.quality));
    if (opts.time) q.set('time', String(opts.time));
    q.set('autoorbit', this.autoOrbit ? '1' : '0');
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') q.set('debug', '1');

    const f = this.frame = document.createElement('iframe');
    f.src = `${TWIN_URL.href}?${q}`;
    f.title = 'Interactive 3D map of Davis Campus';
    f.loading = 'eager';
    f.setAttribute('allow', 'fullscreen');
    f.setAttribute('aria-label', 'Interactive 3D map of Davis Campus');
    Object.assign(f.style, { position:'absolute', inset:'0', width:'100%', height:'100%', border:'0', display:'block', background:'#070914', borderRadius:'inherit' });
    Object.assign(this.mount.style, { position:'relative' });
    this.mount.replaceChildren(f);

    this._onMessage = event => {
      if (this.disposed || event.source !== f.contentWindow || event.origin !== this._expectedOrigin) return;
      const d = event.data;
      if (!d || d.source !== 'davis-twin' || typeof d.type !== 'string') return;
      if (d.type === 'ready') {
        this.ready = true;
        clearTimeout(this._readyTimer); this._readyTimer = null;
        this.refreshAccent();
        this._post({ type:'campus:autoorbit', value:this.autoOrbit });
        for (const msg of this._queue.splice(0)) this._post(msg);
        this._resolveReady?.(true);
        this._resolveReady = null;
      } else if (d.type === 'select') {
        const id = validId(d.id);
        this.focusId = id;
        this.camMode = id ? 'focus' : 'overview';
        this._routeVisible = !!id;
        this.pathBtn?.classList.toggle('is-hidden', !id);
        for (const fn of this._listeners) { try { fn(id); } catch (err) { console.error(err); } }
      } else if (d.type === 'weather') {
        const w = validWeather(d.value);
        if (w) {
          this._weatherCondition = w;
          if (Number.isFinite(Number(d.temp))) this._weatherTemp = Number(d.temp);
          this._updateWeatherChip();
        }
      } else if (d.type === 'status' && typeof this.opts.onStatus === 'function') {
        this.opts.onStatus(String(d.value));
      }
    };
    addEventListener('message', this._onMessage);

    this._onVisibility = () => this._post({ type:'campus:visibility', value:!document.hidden });
    document.addEventListener('visibilitychange', this._onVisibility);

    this._themeObserver = new MutationObserver(() => this.refreshAccent());
    this._themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:['style','class','data-theme'] });

    window.__SC_CAMPUS_MAP_3D__ = this;
    this._installLegacyHud();
  }

  async init() {
    if (this.disposed) return false;
    if (this.ready) return true;
    this._readyTimer = setTimeout(() => {
      if (!this.ready && !this.disposed) this.opts.onStatus?.('3D campus map is taking longer than expected to load.');
    }, 10000);
    return new Promise(resolve => {
      this._resolveReady = resolve;
      this._readyTimeout = setTimeout(() => {
        if (!this.ready && !this.disposed) { this._resolveReady = null; resolve(false); }
      }, 20000);
    });
  }

  _post(message) {
    if (this.disposed) return;
    if (!this.ready || !this.frame.contentWindow) { this._queue.push(message); return; }
    try { this.frame.contentWindow.postMessage(message, this._expectedOrigin); } catch {}
  }

  _updateWeatherChip() {
    if (!this.weatherChip) return;
    const c = validWeather(this.weatherCondition) || 'clear';
    this.weatherChip.querySelector('.cm3d-weather-icon').innerHTML = WEATHER_ICONS[c] || WEATHER_ICONS.clear;
    this.weatherChip.querySelector('.cm3d-weather-temp').textContent = this._weatherTemp == null ? '—°' : `${this._weatherTemp}°`;
    this.weatherChip.dataset.condition = c;
  }

  _installLegacyHud() {
    const hud = document.createElement('div');
    hud.className = 'cm3d-hud';
    hud.innerHTML = `<button class="cm3d-reset" type="button" title="Reset view" aria-label="Reset campus view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button><button class="cm3d-path-toggle is-hidden" type="button" title="Toggle wayfinding paths" aria-label="Toggle wayfinding paths"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h4"/></svg></button>`;
    this.mount.appendChild(hud);
    this.resetBtn = hud.querySelector('.cm3d-reset');
    this.pathBtn = hud.querySelector('.cm3d-path-toggle');
    this.resetBtn.onclick = e => { e.stopPropagation(); this.reset(); };
    this.pathBtn.onclick = e => {
      e.stopPropagation();
      this._routeVisible = !this._routeVisible;
      this._post({ type:'campus:routeVisible', value:this._routeVisible });
      this.pathBtn.classList.toggle('is-off', !this._routeVisible);
    };

    const weather = document.createElement('div');
    weather.className = 'cm3d-weather';
    weather.setAttribute('aria-label', 'Campus weather');
    weather.innerHTML = `<span class="cm3d-weather-icon" aria-hidden="true">${WEATHER_ICONS.clear}</span><span class="cm3d-weather-temp">—°</span>`;
    this.mount.appendChild(weather);
    this.weatherChip = weather;
    this._updateWeatherChip();
    this._removeHostHud = () => { hud.remove(); weather.remove(); };
  }

  focus(id) {
    const key = validId(id);
    if (!key) return;
    this.focusId = key; this.camMode = 'focus'; this._routeVisible = true;
    this.pathBtn?.classList.remove('is-hidden');
    this._post({ type:'campus:select', id:key });
  }

  showLocation(id) { this.focus(id); }
  showRoute(id) { this.focus(id); }
  select(id) { id == null ? this.reset() : this.focus(id); }

  reset() {
    this.focusId = null; this.camMode = 'overview'; this._routeVisible = false;
    this.pathBtn?.classList.add('is-hidden');
    this._post({ type:'campus:reset' });
  }

  autoOrbit(on) {
    this.autoOrbit = Boolean(on) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this._post({ type:'campus:autoorbit', value:this.autoOrbit });
  }

  resize() { this._post({ type:'campus:resize' }); }

  refreshAccent() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (value) this._post({ type:'campus:accent', value });
    this._post({ type:'campus:theme', value:document.documentElement.dataset.theme || (matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark') });
  }

  setWeather(value) {
    const v = validWeather(value);
    if (!v) return;
    this._weatherCondition = v; this._updateWeatherChip();
    this._post({ type:'campus:weather', value:v });
  }
  get weatherCondition() { return this._weatherCondition; }
  set weatherCondition(value) { this.setWeather(value); }

  setSeason(value) { this._post({ type:'campus:season', value:String(value) }); }
  setTime(value) {
    if (value === 'live') this._post({ type:'campus:time', value:'live' });
    else { const d = new Date(value); if (!Number.isNaN(d.getTime())) this._post({ type:'campus:time', value:d.toISOString() }); }
  }
  onSelect(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn); return () => this._listeners.delete(fn);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false;
    clearTimeout(this._readyTimer); clearTimeout(this._readyTimeout);
    this._resolveReady?.(false); this._resolveReady = null;
    removeEventListener('message', this._onMessage);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._themeObserver?.disconnect();
    this._removeHostHud?.();
    this.frame?.remove();
    this._queue = [];
    if (window.__SC_CAMPUS_MAP_3D__ === this) delete window.__SC_CAMPUS_MAP_3D__;
  }

  destroy() { this.dispose(); }
}

export const mountCampusMap3D = (container, opts) => new CampusMap3DManager(container, opts);
export const CampusMap3D = CampusMap3DManager;
export default CampusMap3DManager;
