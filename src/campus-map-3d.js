/* =========================================================================
   CAMPUS MAP 3D — CampusMap3DManager
   ---------------------------------------------------------------------------
   Interactive extruded 3D Davis Campus built from the same footprint paths
   that power the static SVG plan (src/campus-map.js), so the two views can
   never disagree about geometry.

   Pipeline: SVGLoader parses each building `d` path -> THREE.Shape[] ->
   ExtrudeGeometry (bevelled) -> shadow-casting Mesh. A waypoint graph with
   A* drives the animated dashed wayfinding line from the bus stop to any
   building. Camera is a small state machine (overview / focused orbit /
   reset) tweened with GSAP, with manual pointer override that suspends the
   auto-orbit.

   Everything this module creates is disposed in dispose(): geometries,
   materials, render targets, the GSAP tweens, the RAF loop, listeners, and
   the renderer itself — the widget re-creates it cleanly per render.
   ========================================================================= */

const THREE_NS = '[campus-3d]';

/* Scene scale: the SVG viewBox is 930x1000; world units map 1:1 onto it
 * with Y (height) exaggerated for legibility. Ground plane sits at y=0. */
const WORLD = { w: 930, h: 1000 };
const BUILDING_HEIGHT = 46;
const MINOR_HEIGHT = 18;

const PALETTE = {
  ground: 0x101735,
  groundRing: 0x232b52,
  road: 0x1b2347,
  lot: 0x151d3f,
  academic: 0x8b7cf6,
  academicTop: 0xa99dfc,
  athletic: 0x34d1bf,
  transit: 0xf0608a,
  minor: 0x2c3763,
  path: 0x64e0ff,
  pin: 0xffd166
};

/* Building type styling: standard academic vs athletic vs transit-adjacent. */
const BUILDING_STYLES = {
  J: { color: PALETTE.academic, height: BUILDING_HEIGHT },
  H: { color: PALETTE.academic, height: BUILDING_HEIGHT },
  M: { color: PALETTE.academic, height: BUILDING_HEIGHT * 0.8 },
  B: { color: PALETTE.academicTop, height: BUILDING_HEIGHT * 0.9 },
  C: { color: PALETTE.athletic, height: BUILDING_HEIGHT * 0.7 },
  A: { color: PALETTE.academic, height: BUILDING_HEIGHT }
};

/* --- Automated time-of-day engine -----------------------------------------
 * The sun's position (and therefore angle, strength and color) comes from
 * the real NOAA solar position for the campus coordinates at the current
 * instant — sunrise/sunset follow the real calendar incl. DST. */
const SNOW_COUNT = 520;

/* --- Live weather (Open-Meteo, keyless + CORS, ideal for a static site) ----
 * Davis Campus coordinates: Sheridan Davis Campus, Brampton ON. */
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=43.7230&longitude=-79.7130&current=temperature_2m,weather_code,cloud_cover,is_day,wind_speed_10m,precipitation,snowfall&timezone=auto';
const WEATHER_CACHE_KEY = 'sc_weather_cache_v1';
const WEATHER_TTL = 15 * 60 * 1000;

/* WMO weather code + precipitation → the scene condition we can render. */
function conditionFromCode(code, snowfall = 0, precipitation = 0) {
  const c = Number(code) || 0;
  if ((c >= 71 && c <= 77) || c === 85 || c === 86 || Number(snowfall) > 0) return 'snow';
  if (c >= 95) return 'thunder';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || Number(precipitation) > 0.2) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 3) return 'overcast';
  if (c === 1 || c === 2) return 'cloudy';
  return 'clear';
}

/* How each condition grades the environment (fog density, sun/ambient
 * multipliers, and how far to tint the sky/fog toward overcast grey). */
const WEATHER_ENV = {
  clear:    { fog: 0.00034, sun: 1.0,  ambient: 1.0,  tint: 0 },
  cloudy:   { fog: 0.00044, sun: 0.6,  ambient: 1.1,  tint: 0.4 },
  overcast: { fog: 0.00048, sun: 0.42, ambient: 1.15, tint: 0.6 },
  fog:      { fog: 0.00090, sun: 0.5,  ambient: 1.05, tint: 0.7 },
  rain:     { fog: 0.00062, sun: 0.42, ambient: 1.12, tint: 0.55 },
  snow:     { fog: 0.00072, sun: 0.6,  ambient: 1.08, tint: 0.5 },
  thunder:  { fog: 0.00068, sun: 0.35, ambient: 1.1,  tint: 0.65 }
};

/* Minimal stroke icons (no emoji — matches the app's vector-glyph rule). */
const WEATHER_ICONS = {
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cloudy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 16.7"/><path d="M6 19h11.5"/></svg>',
  overcast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 16a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 13.7"/><path d="M5 19h13M7 22h9"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h13M4 17h14"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 13a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 10.7"/><path d="M8 15l-1.5 3M13 15l-1.5 3M18 15l-1.5 3"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M5 6.5l14 11M19 6.5l-14 11"/><path d="M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2"/></svg>',
  thunder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 12a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 9.7"/><path d="M13 12l-3 5h5l-3 5"/></svg>'
};

/* --- Waypoint graph (A*) --------------------------------------------------
 * Coordinates are SVG-space; the graph threads the driveways and walks so
 * paths look intentional rather than cutting through buildings. */
const WAYPOINTS = {
  bus: [376, 452],
  dr1: [324, 452],
  dr2: [324, 520],
  junc1: [372, 648],
  junc2: [396, 706],
  dr3: [324, 178],
  n1: [156, 178],
  n2: [156, 336],
  n3: [324, 336],
  s1: [156, 514],
  s2: [324, 514],
  w1: [60, 726],
  w2: [300, 726],
  rEnt: [452, 706],
  bEnt: [470, 480],
  cEnt: [714, 534],
  aEnt: [684, 636],
  hEnt: [423, 224],
  mEnt: [200, 464],
  jEnt: [412, 76],
  jW1: [324, 66],
  jW2: [404, 62],
  lot1: [734, 726],
  lot3: [396, 776]
};

const WAYPOINT_EDGES = [
  ['bus', 'dr1'], ['dr1', 'dr2'], ['dr1', 'n3'], ['dr1', 's2'],
  ['dr2', 'junc1'], ['junc1', 'junc2'],
  ['n3', 'dr3'], ['dr3', 'n1'], ['n1', 'n2'], ['n2', 's1'], ['s1', 's2'],
  ['junc2', 'w2'], ['w2', 'w1'], ['junc2', 'rEnt'],
  ['bus', 'bEnt'], ['bEnt', 'hEnt'],
  ['junc1', 'mEnt'], ['bus', 'mEnt'],
  ['junc2', 'lot3'], ['rEnt', 'lot1'], ['lot1', 'aEnt'], ['lot1', 'cEnt'],
  ['aEnt', 'cEnt'], ['rEnt', 'cEnt'],
  /* Building J branch: north up the west driveway, then east along the
   * Steeles frontage so the walkway never cuts through the J footprint. */
  ['dr3', 'jW1'], ['jW1', 'jW2'], ['jW2', 'jEnt']
];

const ENTRANCES = {
  J: 'jEnt', H: 'hEnt', M: 'mEnt', B: 'bEnt', C: 'cEnt', A: 'aEnt'
};

/* --- Real solar position (NOAA low-precision algorithm) --------------------
 * Elevation/azimuth from the actual date + campus coordinates, so sunrise,
 * sunset and sun angle follow the real calendar (DST handled automatically —
 * the calculation is clock-based, not hour-table-based). */
const CAMPUS_COORDS = { lat: 43.7230, lon: -79.7130 };

export function solarPosition(date = new Date(), lat = CAMPUS_COORDS.lat, lon = CAMPUS_COORDS.lon) {
  const rad = Math.PI / 180;
  const J1970 = 2440588, J2000 = 2451545;
  const d = date.valueOf() / 86400000 - 0.5 + J1970 - J2000;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  /* Local sidereal time: GMST + EAST longitude (the minus sign here once
   * inverted day and night — sun below the horizon at local noon). */
  const st = rad * (280.16 + 360.9856235 * d) + rad * lon;
  const latR = rad * lat;
  /* Hour angle H = st - RA (positive = afternoon/west). Using RA - st here
   * mirrors the azimuth east-west (sun rising in the west) while leaving
   * elevation untouched. */
  const el = Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(st - RA));
  const az = Math.atan2(Math.sin(st - RA), Math.cos(st - RA) * Math.sin(latR) - Math.tan(dec) * Math.cos(latR));
  return { elevationDeg: el / rad, azimuthDeg: (az / rad + 180) % 360 };
}

/* --- Tiny helpers --------------------------------------------------------- */
function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export class CampusMap3DManager {
  /**
   * @param {HTMLElement} mount element to render the canvas into
   * @param {object} opts { getBuildings: () => Record<id, {d,label,badge,pin}>,
   *                        onStatus(msg): void }
   */
  constructor(mount, opts = {}) {
    this.mount = mount;
    this.opts = opts;
    this.disposed = false;
    this.ready = false;
    this.focusId = null;
    this.camMode = 'overview';
    this.autoOrbit = true;
    this.orbitAngle = Math.PI / 4;
    this.orbitSpeed = 0.05; // rad/s per spec
    this.raf = 0;
    this.lastT = 0;
    this.clockUniform = { value: 0 };
    this._tmp = null;
    this._cleanupFns = [];
    this.pathLines = [];
    this.pathPucks = null;
    this.routeCurve = null;
    this.routeArrows = [];
    this._arrowGeo = null;
    this._arrowMat = null;
    this.busRing = null;
    this.snow = null;
    this._snowData = null;
    this._todKeys = null;
    this.orbitTarget = null;
    /* Spherical camera rig: every camera motion (tweens, auto-orbit, drag,
     * zoom) writes target values; the render loop eases the live values,
     * so all motion shares one smooth, inertial feel. */
    this.sph = { dist: 1500, pitch: 0.66, yaw: Math.PI / 4 };
    this.sphCur = { dist: 1500, pitch: 0.66, yaw: Math.PI / 4 };
    this._tmpA = null;
    this._tmpB = null;
    this._geos = [];
    this._mats = [];
    this._owned = [];
    this.accentColor = opts.accentColor || '#7c8cff';
    this.accentHex = null;                 // resolved to a THREE.Color in init()
  }

  async init() {
    const [threeModule, { SVGLoader }, gsapModule, postModules] = await Promise.all([
      import('three'),
      import('three/addons/loaders/SVGLoader.js'),
      import('gsap'),
      Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/utils/BufferGeometryUtils.js')
      ])
    ]);
    if (this.disposed) return false;
    this.SVGLoader = SVGLoader;
    /* Post-processing chain classes (bloom presentation). */
    const [composerMod, renderPassMod, bloomMod, bufferUtilsMod] = postModules;
    this.EffectComposer = composerMod.EffectComposer;
    this.RenderPass = renderPassMod.RenderPass;
    this.UnrealBloomPass = bloomMod.UnrealBloomPass;
    this.BufferGeometryUtils = bufferUtilsMod;
    /* Browser ESM builds expose Three.js as a namespace, while GSAP exposes
     * its API as either a default export or a namespace depending on the CDN
     * / bundler. Normalize both shapes before constructing the renderer. */
    const THREE = threeModule.default || threeModule;
    const gsap = gsapModule.default || gsapModule.gsap || gsapModule;
    this.THREE = THREE;
    this.gsap = gsap;
    this.loader = new SVGLoader();
    this.accentHex = new THREE.Color(this.accentColor || '#7c8cff');

    this._buildRenderer();
    this._buildScene();
    this._buildLights();
    this._buildGround();
    this._buildInfrastructure();
    this._buildBuildings();
    /* Snap glass to the live theme accent (a saved non-default theme must
     * apply from the first frame, without waiting for a theme change). */
    this.refreshAccent();
    this._buildGraph();
    this._buildCameraRig();
    this._buildWindowGlow();
    this._buildAmbientDust();
    this._buildWeatherSurfaces();
    this._buildPost();
    if (this.disposed || !this.mount.isConnected) { this.dispose(); return false; }
    /* No building is selected at boot — no route, toggle hidden. */
    this._clearPaths();
    this._updatePathToggleVisibility();
    this._buildParticles(this._initialParticleMode());
    this._applyTimeOfDay();
    this._initWeather();
    this._bindEvents();
    this._startLoop();
    this.ready = true;
    return true;
  }

  /* --- Renderer / scene / lights ----------------------------------------- */
  _buildRenderer() {
    const THREE = this.THREE;
    /* Quality tier: mobile caps pixel ratio, shadow map and particle density
     * so the twin stays smooth on phones (tier chosen once, at build time). */
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const smallSide = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
    this.isMobile = Boolean(coarse || smallSide < 620);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.75 : 2));
    /* Filmic presentation: ACES tone mapping + sRGB output give highlights a
     * natural roll-off instead of the harsh clamped look. */
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.softwareGpu = this._detectSoftwareGpu();
    if (this.softwareGpu) {
      /* Software rasterizer (SwiftShader/llvmpipe): cap DPR at 1 — per-pixel
       * cost dominates there, and real devices never hit this tier. */
      this.renderer.setPixelRatio(1);
    }
    this.renderer.domElement.className = 'cm3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D campus map');
    this.renderer.domElement.setAttribute('role', 'img');
    this.mount.appendChild(this.renderer.domElement);

    this.info = null;
    this._flash = 0;
    this._quality = this.isMobile ? 0.6 : 1;      // particle density scaling
    /* Software rasterizers pay full price for every depth texel — keep the
     * live-shadow map at 1024 there; real GPUs get crisp 2048. */
    this._shadowSize = this.softwareGpu ? 768 : this.isMobile ? 1024 : 2048;
    this._bloomBase = this.isMobile ? 0.32 : 0.42;
    this.hoverId = null;
    this.weather = null;
    this.weatherCondition = 'clear';
    this._particleMode = null;
    this._weatherTimer = 0;
    this._todSunI = null;
    this._todAmbientI = null;
    this._todFogColor = null;
    this._overcastTint = null;
    this._tmpFog = null;

    this.hud = document.createElement('div');
    this.hud.className = 'cm3d-hud';
    this.hud.innerHTML = `
      <button class="cm3d-reset" type="button" title="Reset view" aria-label="Reset campus view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
      </button>
      <button class="cm3d-path-toggle" type="button" title="Toggle wayfinding paths" aria-label="Toggle wayfinding paths">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h4"/></svg>
      </button>`;
    this.mount.appendChild(this.hud);
    this.resetBtn = this.hud.querySelector('.cm3d-reset');
    this.pathBtn = this.hud.querySelector('.cm3d-path-toggle');

    /* Minimal live-weather chip (top-left). The old info card is gone: view
     * and building status live in the app header's status line. */
    this.weatherChip = document.createElement('div');
    this.weatherChip.className = 'cm3d-weather';
    this.weatherChip.setAttribute('aria-label', 'Live campus weather');
    this.weatherChip.dataset.condition = this.weatherCondition;
    this.weatherChip.innerHTML = `<span class="cm3d-weather-icon" aria-hidden="true">${WEATHER_ICONS.clear}</span><span class="cm3d-weather-temp">—°</span>`;
    this.mount.appendChild(this.weatherChip);
    if (this.mount) {
      this.mount.dataset.weatherCondition = this.weatherCondition;
      this.mount.dataset.weatherTemp = '';
    }
  }

  _detectSoftwareGpu() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (_) { return false; }
  }

  _buildScene() {
    const THREE = this.THREE;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(PALETTE.ground, 0.00034);

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();

    this.buildingMeshes = [];
    this.meshById = new Map();
    this.pathGroup = new THREE.Group();
    this.pathGroup.visible = true;
    this.scene.add(this.pathGroup);
    this.pathLines = [];
    if (this.mount) this.mount.dataset.pathVisible = 'true';
  }

  _buildLights() {
    const THREE = this.THREE;
    this.ambient = new THREE.AmbientLight(0xcdd6ff, 0.6);
    this.scene.add(this.ambient);

    /* Sky/ground bounce fill: lifts the flat ambient with a natural vertical
     * gradient (three-point lighting, AAA scene staple). */
    this.hemi = new THREE.HemisphereLight(0x8fa4ff, 0x1a2142, 0.5);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.35);
    this.sun.position.set(420, 700, 260);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this._shadowSize, this._shadowSize);
    this.sun.shadow.camera.left = -620;
    this.sun.shadow.camera.right = 620;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.near = 80;
    this.sun.shadow.camera.far = 1900;
    this.sun.shadow.bias = -0.00045;          // z-fighting guard per spec
    this.sun.shadow.normalBias = 0.6;
    /* Live shadows: real GPUs re-render the shadow map every frame so sun
     * angle/intensity changes show immediately. Software tier: on-demand
     * updates flagged whenever lighting actually changes (_applyTimeOfDay /
     * weather) — the sun's per-frame motion is imperceptible, so this is
     * visually identical while skipping a full depth pass per frame. */
    this.sun.shadow.autoUpdate = !this.softwareGpu;
    this.sun.shadow.needsUpdate = true;
    this.scene.add(this.sun);

    /* Storm system: a cold secondary light that flickers during thunder. */
    this.lightning = new THREE.DirectionalLight(0xbcd4ff, 0);
    this.lightning.position.set(-380, 620, -240);
    this.scene.add(this.lightning);

    /* Sun disc glow: rides the real solar position; strength follows
     * elevation and sky clarity (minimalist ray-feel, no lens clutter). */
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._spriteTex, color: 0xffedc8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sunSprite.scale.set(300, 300, 1);
    this.scene.add(this.sunSprite);
    this._track(null, this.sunSprite.material);

    this._buildSky();
  }

  /* --- Sky dome ------------------------------------------------------------
   * A stylized HDRI-feel sky painted by a shader: vertical gradient with a
   * real sun halo at the true solar position, night stars, and weather
   * grading — matched to the site's navy/indigo palette. Attached to the
   * camera target so it never clips, and rendered behind everything. */
  _buildSky() {
    const THREE = this.THREE;
    const geo = new THREE.SphereGeometry(3000, 32, 18);
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uDayF: { value: 0 },
      uHorizonF: { value: 0 },
      uOvercast: { value: 0 },
      uAccent: { value: new THREE.Color(this.accentHex || 0x7c8cff) }
    };
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir; uniform float uDayF; uniform float uHorizonF; uniform float uOvercast; uniform vec3 uAccent;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.259)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.12, 1.0);
          /* Day: site indigo -> pale horizon. Night: deep navy with a subtle
           * accent glow along the horizon band. */
          vec3 dayZenith = vec3(0.12, 0.32, 0.62);   /* true sky blue */
          vec3 dayHorizon = vec3(0.72, 0.82, 0.95);  /* bright blue-white */
          vec3 nightZenith = vec3(0.024, 0.032, 0.09);
          vec3 nightHorizon = vec3(0.07, 0.08, 0.18);
          vec3 zen = mix(nightZenith, dayZenith, uDayF);
          vec3 hor = mix(nightHorizon, dayHorizon, uDayF);
          /* Warm band at sunrise/sunset. */
          vec3 warm = vec3(0.85, 0.44, 0.25);
          hor = mix(hor, warm, uHorizonF * 0.42);
          zen = mix(zen, vec3(0.28, 0.16, 0.22), uHorizonF * 0.3);
          vec3 col = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.78));
          /* Stars fade in with darkness. */
          float star = step(0.9992, hash(floor(d * 420.0))) * (1.0 - uDayF) * smoothstep(0.02, 0.25, d.y);
          col += vec3(star * 0.8);
          /* Sun halo on the true direction. */
          float sunD = max(dot(d, normalize(uSunDir)), 0.0);
          float halo = pow(sunD, 90.0) * 0.9 + pow(sunD, 260.0) * 1.1;
          vec3 sunTint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.93, 0.8), uDayF);
          col += sunTint * (halo * 1.25) * (1.0 - uOvercast * 0.85) * smoothstep(-0.12, 0.1, uSunDir.y);
          /* Overcast washes the sky toward flat grey. */
          /* Overcast: bright neutral-grey wash (real overcast skies are
             almost as bright as clear ones — never a dark grey shroud). */
          col = mix(col, vec3(0.82, 0.85, 0.90) * (0.55 + 0.45 * uDayF), uOvercast * 0.72);
          /* Fog band at the horizon ties the dome to the campus haze. */
          float fogBand = 1.0 - smoothstep(0.0, 0.22, d.y);
          col = mix(col, vec3(0.09, 0.11, 0.22), fogBand * (1.0 - uDayF) * 0.55);
          /* Day haze: pale blue at the horizon (not navy) so the dome meets
             the ground without a dark seam. */
          col = mix(col, vec3(0.62, 0.71, 0.86), fogBand * uDayF * 0.40);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.raycast = () => {};
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this._track(geo, this.skyMat);
  }

  /* Stylized window glow: emissive panels on the primary facades that light
   * up at dusk/night, giving the twin its "city lights" read. */
  _buildWindowGlow() {
    const THREE = this.THREE;
    this.windowGlow = [];
    this.lightPools = [];
    this.facadeGlows = [];
    this._nightWindows = [];
    /* Warm light pools on the ground under each building: this is what makes
     * a night city read from a high camera — panels alone are 2-3px specks
     * at overview distance, pools carry the glow. */
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();
    this.poolMat = new THREE.MeshBasicMaterial({
      map: this._spriteTex, color: 0xffc27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._track(null, this.poolMat);

    for (const mesh of this.buildingMeshes) {
      const id = mesh.userData.buildingId || 'X';
      const box = new THREE.Box3().setFromObject(mesh);
      /* Deterministic per-building rhythm: column pitch, lit probability and
       * brightness jitter all derive from the id, so every building has its
       * own window character. */
      const seedOf = (n) => { const x = Math.sin(n * 127.1 + id.charCodeAt(0) * 311.7) * 43758.5453; return x - Math.floor(x); };
      const colPitch = 10 + seedOf(1) * 6;             // 10-16u between windows
      const winW = colPitch * 0.52;
      const winH = 4.5 + seedOf(2) * 3.5;              // 4.5-8u tall
      const litP = 0.5 + seedOf(3) * 0.3;              // 50-80% lit at night
      const y0 = box.min.y + 8, y1 = box.max.y - 4;
      const rows = Math.max(1, Math.floor((y1 - y0) / (winH * 2.2)));
      const rowPitch = (y1 - y0) / rows;

      /* Facades: extrusion maps SVG +X->world +X, +Y->world −Z, so the wall
       * planes are z = box.min.z (back) and z = box.max.z (front). We grid
       * ONLY these real wall faces with exact in-wall bounds — windows can
       * never float in mid-air, even on L-shaped footprints. */
      const faces = [
        { z: box.max.z + 0.35, flip: 1 },
        { z: box.min.z - 0.35, flip: -1 }
      ];
      const cells = [];
      /* L-shaped footprints: the bounding-box plane only matches the actual
       * wall in parts. Raycast each column against the real geometry and
       * anchor the pane where the wall actually is — never mid-air. */
      const ray = new THREE.Raycaster();
      ray.far = 220;
      const origin = new THREE.Vector3();
      const dirV = new THREE.Vector3();
      for (const face of faces) {
        for (let r = 0; r < rows; r++) {
          const wy = y0 + (r + 0.5) * rowPitch;
          for (let c = 0; ; c++) {
            const wx = box.min.x + 6 + (c + 0.5) * colPitch;
            if (wx > box.max.x - 6) break;
            origin.set(wx, wy, face.z - face.flip * 60);   // start off-wall
            dirV.set(0, 0, face.flip);
            ray.set(origin, dirV);
            const hit = ray.intersectObject(mesh, false)[0];
            if (!hit) continue;                            // open air: no wall here
            const rnd = seedOf(r * 57 + c * 13 + (face.flip > 0 ? 0 : 91));
            if (rnd < 0.14) continue;                      // structural gap
            cells.push({
              x: wx, y: wy, z: hit.point.z + face.flip * 0.35,  // hugging the wall
              on: rnd < litP,
              tint: rnd * 9 % 1 < 0.33 ? 0xd6e4ff : rnd * 9 % 1 < 0.66 ? 0xffd9a0 : 0xffc98a,
              bright: 0.72 + seedOf(r * 31 + c * 7 + 5) * 0.55   // 0.72-1.27
            });
          }
        }
      }
      if (!cells.length) continue;

      /* One InstancedMesh per building (1 draw call). Real emissive material:
       * lit windows push past the bloom threshold at night, so they glow,
       * cast halo rays through the post chain and pick up ACES rolloff. */
      const wg = new THREE.PlaneGeometry(winW, winH);
      /* Real GPUs: emissive standard material so windows bloom as light
       * sources. Software tier: unlit basic material with the same instance
       * colors — identical read, no per-fragment lighting cost. */
      const wm = this.softwareGpu
        ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
        : new THREE.MeshStandardMaterial({
            color: 0x0c1120, roughness: 0.35, metalness: 0.1,
            emissive: 0xffffff, emissiveIntensity: 0,
            transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false
          });
      const inst = new THREE.InstancedMesh(wg, wm, cells.length);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      cells.forEach((cell, i) => {
        m4.makeTranslation(cell.x, cell.y, cell.z);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.setHex(cell.on ? cell.tint : 0x05070d).multiplyScalar(cell.bright));
      });
      inst.raycast = () => {};
      this.scene.add(inst);
      this._track(wg, wm);
      this._owned.push(inst);
      this.windowGlow.push(inst);
      this._nightWindows.push({
        inst, wm, cells,
        timers: cells.map((c) => (c.on ? -1 : 8 + Math.random() * 30))
      });

      /* Outward facade glow: a soft additive halo rising off the lit wall
       * into the map — the "light spills out of the windows" read. */
      const fw = Math.min(box.max.x - box.min.x + 46, 190);
      const fh = Math.min(box.max.y - box.min.y + 26, 120);
      const glowGeo = new THREE.PlaneGeometry(fw, fh);
      const glowMat = new THREE.MeshBasicMaterial({
        map: this._spriteTex, color: 0xffc98a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set((box.min.x + box.max.x) / 2, (y0 + y1) / 2 + 4, box.max.z + 14);
      glow.renderOrder = 3;
      glow.raycast = () => {};
      this.scene.add(glow);
      this._track(glowGeo, glowMat);
      this._owned.push(glow);
      this.facadeGlows.push(glow);

      /* One soft pool hugging the building's projected footprint. */
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      const pg = new THREE.PlaneGeometry(span * 1.9, span * 1.9);
      const pool = new THREE.Mesh(pg, this.poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set((box.min.x + box.max.x) / 2, 1.6, (box.min.z + box.max.z) / 2 + 6);
      pool.renderOrder = 2;
      pool.raycast = () => {};
      this.scene.add(pool);
      this._track(pg);
      this._owned.push(pool);
      this.lightPools.push(pool);
    }
  }

  /* Post chain: MSAA-backed composer + UnrealBloom for the neon signage
   * (wayfinding paths, shuttle halo, night windows). */
  _buildPost() {
    const THREE = this.THREE;
    if (!this.EffectComposer) return;
    /* Adaptive quality: bloom is a stack of fullscreen blurs — the single
     * most expensive effect. Skip it on software renderers and lean on the
     * emissive + additive materials for the neon read instead. */
    if (this.softwareGpu) return;
    const size = new THREE.Vector2(this.mount.clientWidth || 600, this.mount.clientHeight || 420);
    this.composer = new this.EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new this.RenderPass(this.scene, this.camera));
    this.bloomPass = new this.UnrealBloomPass(size, this._bloomBase, 0.55, 0.82);
    this.composer.addPass(this.bloomPass);
  }

  _buildGround() {
    const THREE = this.THREE;
    const g = new THREE.CircleGeometry(468, 72);
    /* Lifted, semi-glossy surface: catches sky/sun so it reads as a lit
     * plaza instead of a black void, and carries real-time sun shadows. */
    const m = new THREE.MeshStandardMaterial({ color: 0x2b3766, roughness: 0.58, metalness: 0.28 });
    this.groundMat = m;
    this.ground = new THREE.Mesh(g, m);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(WORLD.w / 2, -0.4, WORLD.h / 2);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this._track(g, m);

    /* Minimal blueprint grid: barely-there lines over the plaza surface. */
    const grid = new THREE.GridHelper(936, 52, 0x55679f, 0x3c4c85);
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.position.set(WORLD.w / 2, -0.25, WORLD.h / 2);
    this.scene.add(grid);
    this.grid = grid;
    this._owned.push(grid);

    const ringG = new THREE.RingGeometry(462, 468, 96);
    const ringM = new THREE.MeshBasicMaterial({ color: PALETTE.groundRing, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringG, ringM);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(WORLD.w / 2, 0.1, WORLD.h / 2);
    this.scene.add(this.ring);
    this._track(ringG, ringM);
  }

  /* --- Campus infrastructure: roads, parking lots, glowing transit marker -- */
  _buildInfrastructure() {
    const THREE = this.THREE;
    const infra = (this.opts.getInfrastructure ? this.opts.getInfrastructure() : {});
    /* [centerX, centerZ, width, depth] — Steeles Ave W along the top,
     * McLaughlin Road along the west (matches the traced SVG plan). */
    const roads = infra.roads || [
      [WORLD.w / 2, 38, WORLD.w, 48],
      [43, 364, 34, 700]
    ];
    const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 0.95, metalness: 0 });
    this.roadMat = roadMat;
    this._track(null, roadMat);
    for (const [cx, cz, w, d] of roads) {
      const g = new THREE.BoxGeometry(w, 0.3, d);
      const m = new THREE.Mesh(g, roadMat);
      m.position.set(cx, 0.05, cz);
      m.receiveShadow = true;
      this.scene.add(m);
      this._track(g);
    }

    const lotMat = new THREE.MeshStandardMaterial({ color: PALETTE.lot, roughness: 0.9, metalness: 0.05 });
    const lotEdgeMat = new THREE.LineBasicMaterial({ color: 0x40508f, transparent: true, opacity: 0.55 });
    this._track(null, lotMat);
    this._track(null, lotEdgeMat);
    for (const lot of (infra.lots || [])) {
      const g = new THREE.BoxGeometry(lot.w, 0.25, lot.h);
      const m = new THREE.Mesh(g, lotMat);
      m.position.set(lot.x + lot.w / 2, 0.04, lot.y + lot.h / 2);
      m.receiveShadow = true;
      this.scene.add(m);
      const eg = new THREE.EdgesGeometry(g);
      const el = new THREE.LineSegments(eg, lotEdgeMat);
      el.position.copy(m.position);
      el.raycast = () => {};
      this.scene.add(el);
      this._track(g);
      this._track(eg);
    }

    /* Visible pedestrian walkways: one slab per unique A* graph edge, so the
     * route arrows always follow a path you can see on the ground — and the
     * graph is drawn to avoid building footprints by construction. */
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x36427a, roughness: 0.85, metalness: 0.05 });
    this.walkMat = walkMat;
    this._track(null, walkMat);
    const seen = new Set();
    const parts = [];
    const m4 = new THREE.Matrix4(), eul = new THREE.Euler(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    for (const [a, b] of WAYPOINT_EDGES) {
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const A = WAYPOINTS[a], B = WAYPOINTS[b];
      if (!A || !B) continue;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const g = new THREE.BoxGeometry(9, 0.22, len + 9);
      eul.set(0, Math.atan2(B[0] - A[0], B[1] - A[1]), 0);
      q.setFromEuler(eul);
      pv.set((A[0] + B[0]) / 2, 0.32, (A[1] + B[1]) / 2);
      g.applyMatrix4(m4.compose(pv, q, sc));
      parts.push(g);
    }
    if (parts.length && this.BufferGeometryUtils) {
      const merged = this.BufferGeometryUtils.mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, walkMat);
      m.receiveShadow = true;
      m.raycast = () => {};
      this.scene.add(m);
      this._track(merged);
    } else if (parts.length) {
      for (const g of parts) {
        const m = new THREE.Mesh(g, walkMat);
        m.receiveShadow = true;
        this.scene.add(m);
        this._track(g);
      }
    }

    /* Low cloud layer: sprite puffs at ~320u that drift slowly. Opacity and
     * color are driven by the live weather condition. */
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();
    this.cloudMat = new THREE.SpriteMaterial({ map: this._spriteTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this._track(null, this.cloudMat);
    this.clouds = [];
    const nClouds = Math.round(14 * (this._quality || 1));
    for (let i = 0; i < nClouds; i++) {
      const c = new THREE.Sprite(this.cloudMat);
      c.position.set(Math.random() * WORLD.w, 300 + Math.random() * 130, Math.random() * WORLD.h);
      const sc = 180 + Math.random() * 210;
      c.scale.set(sc * 1.7, sc, 1);
      c.userData.ph = Math.random() * Math.PI * 2;
      c.raycast = () => {};
      this.scene.add(c);
      this.clouds.push(c);
    }

    /* Shuttle bus stop: glowing puck + pulsing halo (animated in the loop). */
    const stop = infra.shuttleStop || [376, 450];
    const puckG = new THREE.CylinderGeometry(10, 10, 3, 24);
    const puckM = new THREE.MeshBasicMaterial({ color: PALETTE.path, transparent: true, opacity: 0.9 });
    const puck = new THREE.Mesh(puckG, puckM);
    puck.position.set(stop[0], 1.8, stop[1]);
    this.scene.add(puck);
    this._track(puckG, puckM);
    const ringG = new THREE.RingGeometry(13, 16, 40);
    const ringM = new THREE.MeshBasicMaterial({ color: PALETTE.path, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    this.busRing = new THREE.Mesh(ringG, ringM);
    this.busRing.rotation.x = -Math.PI / 2;
    this.busRing.position.set(stop[0], 0.5, stop[1]);
    this.scene.add(this.busRing);
    this._track(ringG, ringM);
  }

  /* --- Buildings via SVGLoader -> ExtrudeGeometry ------------------------- */
  _shapesFromPath(d) {
    const parsed = this.loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
    return parsed.paths.flatMap((p) => this.SVGLoader.createShapes(p));
  }

  _buildBuildings() {
    const THREE = this.THREE;
    const buildings = (this.opts.getBuildings ? this.opts.getBuildings() : {});
    for (const [id, b] of Object.entries(buildings)) {
      let shapes;
      try { shapes = this._shapesFromPath(b.d); } catch (_) { continue; }
      const style = BUILDING_STYLES[id] || { color: PALETTE.academic, height: BUILDING_HEIGHT };
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: style.height,
        bevelEnabled: true,
        bevelThickness: 3,
        bevelSize: 2.5,
        bevelSegments: 2,
        curveSegments: 6
      });
      /* rotation.x = π/2 keeps the footprint mapping (SVG y -> world z) but
       * sends the extrusion along -Y; lift the geometry so the mass rises
       * from ground level instead of sinking beneath it. */
      geo.translate(0, 0, -(style.height + 3));
      /* Glass skyscraper look: accent-tinted translucent body. Per-mesh
       * material (windows/u-vary read from userData in the shader). */
      /* Translucent glass tinted by the live theme accent (never a fixed
       * purple): body lerps slightly toward white for readability. */
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.accentColor).lerp(new THREE.Color(0xffffff), 0.18),
        transparent: true,
        opacity: 0.55,
        roughness: 0.22,
        metalness: 0.35,
        emissive: new THREE.Color(this.accentColor),
        emissiveIntensity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      mat.userData.windows = 0;
      const mesh = new THREE.Mesh(geo, mat);
      /* SVG Y grows downward; world Z keeps the same orientation so labels
       * and paths transfer without flipping. Shape Z becomes height. */
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(0, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.buildingId = id;
      mesh.userData.baseColor = style.color;
      mesh.userData.label = b.label;
      this.scene.add(mesh);
      /* Blueprint wireframe outline for the architectural read; a child of the
       * mesh so focus scaling applies to it and raycasts ignore it. */
      const wireGeo = new THREE.EdgesGeometry(geo, 26);
      const wireMat = new THREE.LineBasicMaterial({ color: 0xaebcff, transparent: true, opacity: 0.26 });
      const wire = new THREE.LineSegments(wireGeo, wireMat);
      wire.raycast = () => {};
      mesh.add(wire);
      this._track(wireGeo, wireMat);
      this.buildingMeshes.push(mesh);
      this.meshById.set(id, mesh);
      this._track(geo, mat);
    }

    /* Low landmark blocks for context (Union Central / residence / childcare). */
    const minors = [
      [370, 370, 96, 42],
      [822, 602, 30, 158],
      [828, 822, 48, 94]
    ];
    const minorMat = new THREE.MeshStandardMaterial({ color: PALETTE.minor, roughness: 0.9, metalness: 0 });
    for (const [x, y, w, h] of minors) {
      const g = new THREE.BoxGeometry(w, MINOR_HEIGHT, h);
      const m = new THREE.Mesh(g, minorMat);
      m.position.set(x + w / 2, MINOR_HEIGHT / 2, y + h / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this._track(g);
    }
    this._track(null, minorMat);
  }

  /* --- Weather surface effects --------------------------------------------
   * Snow: a soft white blanket plane that fades in and slowly rises while it
   * snows (plus per-building roof caps). Rain: clear gloss planes on the
   * ground and roofs that make surfaces look wet and reflective. */
  _buildWeatherSurfaces() {
    const THREE = this.THREE;
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();

    /* Snow blanket: large soft-edged plane slightly above the ground. */
    const sg = new THREE.PlaneGeometry(WORLD.w + 80, WORLD.h + 80);
    this.snowBlanketMat = new THREE.MeshBasicMaterial({
      map: this._spriteTex, color: 0xeef3ff, transparent: true, opacity: 0,
      depthWrite: false
    });
    this.snowBlanket = new THREE.Mesh(sg, this.snowBlanketMat);
    this.snowBlanket.rotation.x = -Math.PI / 2;
    this.snowBlanket.position.set(WORLD.w / 2, 1.1, WORLD.h / 2);
    this.snowBlanket.renderOrder = 1;
    this.snowBlanket.visible = false;
    this.snowBlanket.raycast = () => {};
    this.scene.add(this.snowBlanket);
    this._track(sg, this.snowBlanketMat);

    /* Snow depth drives opacity up + height creep for the pile-up feel. */
    this.snowDepth = 0;

    /* Wetness: additive gloss layers on ground + roads. */
    const wg = new THREE.CircleGeometry(468, 64);
    this.wetMat = new THREE.MeshBasicMaterial({
      color: 0x9fc8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.wetPlane = new THREE.Mesh(wg, this.wetMat);
    this.wetPlane.rotation.x = -Math.PI / 2;
    this.wetPlane.position.set(WORLD.w / 2, 0.75, WORLD.h / 2);
    this.wetPlane.visible = false;
    this.wetPlane.raycast = () => {};
    this.scene.add(this.wetPlane);
    this._track(wg, this.wetMat);
    this.wetness = 0;

    /* Roof snow/wet caps share the blanket/wet materials. */
    this.roofCaps = [];
    for (const mesh of this.buildingMeshes) {
      const box = new THREE.Box3().setFromObject(mesh);
      const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
      const rg = new THREE.PlaneGeometry(w * 1.02, d * 1.02);
      const cap = new THREE.Mesh(rg, this.snowBlanketMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.8, (box.min.z + box.max.z) / 2);
      cap.visible = false;
      cap.raycast = () => {};
      this.scene.add(cap);
      this._track(rg);
      this.roofCaps.push(cap);
    }
  }

  /* --- Waypoint graph + A* ------------------------------------------------ */
  _buildGraph() {
    this.adj = new Map();
    for (const [a, b] of WAYPOINT_EDGES) {
      if (!this.adj.has(a)) this.adj.set(a, []);
      if (!this.adj.has(b)) this.adj.set(b, []);
      this.adj.get(a).push(b);
      this.adj.get(b).push(a);
    }
  }

  _astar(startId, goalId) {
    if (!this.adj.has(startId) || !this.adj.has(goalId)) return null;
    const open = new Set([startId]);
    const came = new Map();
    const g = new Map([[startId, 0]]);
    const f = new Map([[startId, dist2(WAYPOINTS[startId], WAYPOINTS[goalId])]]);
    while (open.size) {
      let cur = null, best = Infinity;
      for (const id of open) {
        const v = f.get(id) ?? Infinity;
        if (v < best) { best = v; cur = id; }
      }
      if (cur === goalId) {
        const path = [cur];
        while (came.has(path[0])) path.unshift(came.get(path[0]));
        return path;
      }
      open.delete(cur);
      for (const nb of this.adj.get(cur) || []) {
        const tentative = (g.get(cur) || 0) + dist2(WAYPOINTS[cur], WAYPOINTS[nb]);
        if (tentative < (g.get(nb) ?? Infinity)) {
          came.set(nb, cur);
          g.set(nb, tentative);
          f.set(nb, tentative + dist2(WAYPOINTS[nb], WAYPOINTS[goalId]));
          open.add(nb);
        }
      }
    }
    return null;
  }

  _smooth(points, iterations = 2) {
    /* Chaikin corner-cutting: turns the polyline into a soft route. */
    let pts = points.map((p) => [p[0], p[1]]);
    for (let it = 0; it < iterations; it++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    return pts;
  }

  _buildPathLine(points) {
    const THREE = this.THREE;
    const smooth = this._smooth(points);
    const verts = new Float32Array(smooth.length * 3);
    smooth.forEach(([x, y], i) => {
      verts[i * 3] = x; verts[i * 3 + 1] = 6; verts[i * 3 + 2] = y;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: this.clockUniform,
        uColor: { value: new THREE.Color(PALETTE.path) },
        uOpacity: { value: 0.8 },
        uFocus: { value: 0 },
        uReveal: { value: 0 },
        uTotal: { value: 1 }
      },
      vertexShader: `
        varying vec2 vUvX;
        attribute float aDist;
        varying float vDist;
        void main() {
          vDist = aDist;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform float uFocus;
        uniform float uReveal; uniform float uTotal;
        varying float vDist;
        void main() {
          float dash = 26.0;
          float flow = fract((vDist - uTime * 90.0) / dash);
          float arrow = smoothstep(0.0, 0.35, flow) * (1.0 - smoothstep(0.55, 1.0, flow));
          float alpha = uOpacity * (0.35 + 0.65 * arrow);
          alpha *= mix(1.0, 1.15, uFocus);
          alpha *= smoothstep(0.0, 90.0, uReveal - vDist);
          alpha *= 1.0 - smoothstep(uTotal - 55.0, uTotal, vDist);
          gl_FragColor = vec4(uColor, alpha);
        }`
    });
    /* Attach cumulative distance attribute for the flow shader. */
    const pos = geo.getAttribute('position');
    const dists = new Float32Array(pos.count);
    let acc = 0;
    for (let i = 1; i < pos.count; i++) {
      acc += Math.hypot(pos.getX(i) - pos.getX(i - 1), pos.getZ(i) - pos.getZ(i - 1));
      dists[i] = acc;
    }
    geo.setAttribute('aDist', new THREE.BufferAttribute(dists, 1));
    mat.uniforms.uTotal.value = acc;

    const line = new THREE.Line(geo, mat);
    line.renderOrder = 5;
    return { line, mat };
  }

  _showPathFor(buildingId) {
    const THREE = this.THREE;
    this._clearPaths();
    const entrance = ENTRANCES[buildingId];
    if (!entrance) return;
    const ids = this._astar('bus', entrance);
    if (!ids || ids.length < 2) return;
    const pts = this._smooth(ids.map((id) => WAYPOINTS[id]));
    const { line, mat } = this._buildPathLine(pts);
    /* Cinematic reveal: the route paints itself from the bus stop outward. */
    mat.uniforms.uReveal.value = 0;
    this.gsap.to(mat.uniforms.uReveal, { value: mat.uniforms.uTotal.value + 70, duration: 1.1, ease: 'power2.out' });
    this.pathGroup.add(line);
    this.pathLines.push({ line, mat });

    /* Glowing floating arrows flowing along a CatmullRom spline through the
     * same smoothed waypoints (spec: animated directional wayfinding). */
    const curve = new THREE.CatmullRomCurve3(
      pts.map(([x, y]) => new THREE.Vector3(x, 8, y)),
      false, 'catmullrom', 0.5
    );
    this.routeCurve = curve;
    if (!this._arrowGeo) {
      this._arrowGeo = new THREE.ConeGeometry(5, 12, 4);
      this._arrowGeo.rotateX(Math.PI / 2);
      this._arrowMat = new THREE.MeshBasicMaterial({
        color: PALETTE.path, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false
      });
      this._track(this._arrowGeo, this._arrowMat);
    }
    const ARROWS = 14;
    for (let i = 0; i < ARROWS; i++) {
      const arrow = new THREE.Mesh(this._arrowGeo, this._arrowMat);
      arrow.raycast = () => {};
      const t = i / ARROWS;
      arrow.position.copy(curve.getPointAt(t));
      arrow.lookAt(curve.getPointAt((t + 0.02) % 1));
      this.pathGroup.add(arrow);
      this.routeArrows.push({ mesh: arrow, t });
    }

    /* Route markers: subtle origin/target pucks. */
    const puckGeo = new THREE.CylinderGeometry(9, 9, 4, 24);
    const originMat = new THREE.MeshBasicMaterial({ color: PALETTE.path, transparent: true, opacity: 0.85 });
    const origin = new THREE.Mesh(puckGeo, originMat);
    const p0 = WAYPOINTS.bus;
    origin.position.set(p0[0], 3, p0[1]);
    this.pathGroup.add(origin);
    this._track(puckGeo, originMat);

    const targetMat = new THREE.MeshBasicMaterial({ color: PALETTE.pin, transparent: true, opacity: 0.9 });
    const target = new THREE.Mesh(puckGeo, targetMat);
    const p1 = WAYPOINTS[entrance];
    target.position.set(p1[0], 3, p1[1]);
    this.pathGroup.add(target);
    this._track(null, targetMat);
    this.pathPucks = [origin, target];
    if (this.mount) this.mount.dataset.pathSegments = String(this.pathLines.length);
  }

  _clearPaths() {
    for (const { line, mat } of (this.pathLines || [])) {
      this.pathGroup.remove(line);
      line.geometry.dispose();
      if (mat) mat.dispose();
    }
    this.pathLines = [];
    for (const a of this.routeArrows || []) this.pathGroup.remove(a.mesh);
    this.routeArrows = [];
    this.routeCurve = null;
    if (this.mount) this.mount.dataset.pathSegments = '0';
    if (this.pathPucks) {
      for (const p of this.pathPucks) this.pathGroup.remove(p);
      this.pathPucks = null;
    }
  }

  setPathsVisible(v) {
    this.pathGroup.visible = v;
    this.pathBtn.classList.toggle('is-off', !v);
    this.mount.dataset.pathVisible = String(v);
  }

  /* --- Atmospheric particles: condition-driven rain / snow ------------------ */
  _initialParticleMode() {
    /* Offline/first-frame default until live weather lands: snow in the
     * Brampton winter months, otherwise a clear scene. */
    const m = new Date().getMonth();
    return (m === 11 || m <= 2) ? 'snow' : 'none';
  }

  _buildParticles(mode = 'none') {
    const THREE = this.THREE;
    if (this.snow) {
      this.scene?.remove(this.snow);
      this.snow.geometry.dispose();
      this.snow.material.dispose();
      this.snow = null;
      this._snowData = null;
    }
    this._particleMode = mode;
    if (mode === 'none' || this.disposed || !this.scene) return;
    /* Quality tier scales density: mobile keeps the atmosphere at ~60%. */
    const q = this._quality || 1;
    const conf = mode === 'rain'
      ? { n: Math.round(900 * q), size: 2.2, opacity: 0.55, color: 0xbfe3ff, speed: [420, 620] }
      : { n: Math.round(SNOW_COUNT * q), size: 3.2, opacity: 0.66, color: 0xdfe8ff, speed: [22, 56] };
    const positions = new Float32Array(conf.n * 3);
    const phases = new Float32Array(conf.n);
    const speeds = new Float32Array(conf.n);
    for (let i = 0; i < conf.n; i++) {
      positions[i * 3] = Math.random() * WORLD.w;
      positions[i * 3 + 1] = Math.random() * 460;
      positions[i * 3 + 2] = Math.random() * WORLD.h;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = conf.speed[0] + Math.random() * (conf.speed[1] - conf.speed[0]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();
    const mat = new THREE.PointsMaterial({
      color: conf.color, size: conf.size, map: this._spriteTex, transparent: true, opacity: conf.opacity,
      alphaTest: 0.02, blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false, fog: true
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.raycast = () => {};
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this._snowData = { phases, speeds, mode };
  }

  _makeSpriteTexture() {
    /* Soft round particle sprite: kills the square-particle artifact. */
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new this.THREE.CanvasTexture(c);
    this._track(null, tex);
    return tex;
  }

  _buildAmbientDust() {
    /* Always-on drifting motes: the "living air" layer that separates a
     * static render from a scene. Cheaper than the weather systems. */
    const THREE = this.THREE;
    if (this.dust || this.disposed || !this.scene) return;
    const n = Math.round(220 * (this._quality || 1));
    const positions = new Float32Array(n * 3);
    const phases = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = Math.random() * WORLD.w;
      positions[i * 3 + 1] = 6 + Math.random() * 120;
      positions[i * 3 + 2] = Math.random() * WORLD.h;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (!this._spriteTex) this._spriteTex = this._makeSpriteTexture();
    const mat = new THREE.PointsMaterial({
      color: 0xaebcff, size: 1.7, map: this._spriteTex, transparent: true, opacity: 0.28,
      alphaTest: 0.02, blending: THREE.AdditiveBlending, sizeAttenuation: true, depthWrite: false, fog: true
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.raycast = () => {};
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this._dustData = { phases };
    this._track(geo, mat);
  }

  _animateParticles(dt) {
    if (this.disposed) return;
    const t = this.clockUniform.value;
    /* Ambient dust rises and swirls regardless of weather. */
    if (this.dust) {
      const dp = this.dust.geometry.getAttribute('position');
      const dPhases = this._dustData.phases;
      for (let i = 0; i < dp.count; i++) {
        let y = dp.getY(i) + 3.5 * dt;
        if (y > 130) y = 6;
        dp.setY(i, y);
        dp.setX(i, dp.getX(i) + Math.sin(t * 0.35 + dPhases[i]) * 4 * dt);
      }
      dp.needsUpdate = true;
    }
    if (!this.snow || this._particleMode === 'none') return;
    const pos = this.snow.geometry.getAttribute('position');
    const { phases, speeds, mode } = this._snowData;
    if (mode === 'rain') {
      /* Rain: fast slanted streaks; a light sway keeps drops from reading as
       * perfectly parallel lines. */
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - speeds[i] * dt;
        let x = pos.getX(i) + (16 + Math.sin(t * 2 + phases[i]) * 6) * dt;
        if (y < 2) { y = 470 + Math.random() * 40; x = Math.random() * WORLD.w; }
        if (x > WORLD.w) x -= WORLD.w;
        pos.setXYZ(i, x, y, pos.getZ(i));
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - speeds[i] * dt;
        if (y < 4) y = 470 + Math.random() * 30;
        pos.setY(i, y);
        /* Gentle wind drift, phase-offset per flake. */
        pos.setX(i, pos.getX(i) + Math.sin(t * 0.6 + phases[i]) * 6 * dt);
      }
    }
    pos.needsUpdate = true;
  }

  /* --- Time-of-day engine (dawn / midday / dusk / night) -------------------- */
  _smooth01(x, a, b) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  _applyTimeOfDay() {
    const THREE = this.THREE;
    this._todFogColor = this._todFogColor || new THREE.Color();
    this._overcastTint = this._overcastTint || new THREE.Color(0x8a94a8);
    this._tmpFog = this._tmpFog || new THREE.Color();
    /* _solarOverride lets the harness (or a future time-scrub control) force
     * a sun elevation/azimuth to exercise true daylight & night states. */
    const sp = this._solarOverride || solarPosition(new Date());
    const el = sp.elevationDeg;              // sun elevation, degrees
    const az = sp.azimuthDeg;                // azimuth from north, clockwise
    this._solarElevation = el;
    this._solarAzimuth = az;
    /* Phase key from actual solar elevation (civil twilight boundaries). */
    const phaseKey = el <= -6 ? 'night' : el < 3 ? (az < 180 ? 'dawn' : 'dusk') : 'midday';
    this._todKeys = phaseKey;

    const dayF = this._smooth01(el, -8, 10);          // 0 night -> 1 day
    /* Continuous darkness factor: drives window/pool glow so they follow
     * real light levels, not phase labels (windows must be off in daylight
     * even while the phase is still 'dusk' or 'dawn'). */
    this._nightF = Math.pow(1 - dayF, 1.2);
    const horizonF = Math.max(0, 1 - Math.abs(el) / 16); // sunrise/sunset warmth
    const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

    /* Sun direction from the real azimuth/elevation (map north = -Z). */
    const elR = el * Math.PI / 180, azR = az * Math.PI / 180;
    const sunPos = new THREE.Vector3(
      Math.sin(azR) * Math.cos(elR),
      Math.sin(elR),
      -Math.cos(azR) * Math.cos(elR)
    ).multiplyScalar(1100);
    this.sun.position.copy(sunPos);
    /* Sun color: warm on the horizon -> neutral high in the sky. */
    this.sun.color.copy(lerpC(0xff8f4d, 0xfff4e2, this._smooth01(el, 2, 38)));
    this._todSunI = 1.85 * this._smooth01(el, -1, 14);
    this.sun.intensity = this._todSunI;

    /* Ambient + hemisphere fill follow daylight. */
    this._todAmbientI = 0.36 + 0.5 * dayF;
    this.ambient.intensity = this._todAmbientI;
    this.ambient.color.copy(lerpC(0x44508f, 0xcdd6ff, dayF));
    if (this.hemi) {
      this.hemi.intensity = 0.22 + 0.58 * dayF;
      this.hemi.color.copy(lerpC(0x27305e, 0x9db8ff, dayF));
    }

    /* Sky/fog: deep navy night -> pale day, warmed at sunrise/sunset. */
    const fog = lerpC(0x0a0e28, 0x18204a, dayF);
    fog.lerp(new THREE.Color(0x7a4a33), horizonF * 0.32 * (el > -8 ? 1 : 0));
    this._todFogColor.copy(fog);
    this.scene.fog.color.copy(fog);
    this.renderer?.setClearColor(fog, 1);

    /* Sun glow sprite rides the real sun position (clean ray-glow that
     * strengthens with elevation and sky clarity). */
    if (this.sunSprite) {
      this.sunSprite.position.copy(sunPos).setLength(1600);
      const clarity = { clear: 1, cloudy: 0.45, overcast: 0.12, fog: 0.1, rain: 0.15, snow: 0.3, thunder: 0.08 }[this.weatherCondition] ?? 0.8;
      this.sunSprite.material.opacity = Math.max(0, this._smooth01(el, -2, 12)) * (0.35 + 0.4 * clarity);
      const s = 300 + 90 * this._smooth01(el, 0, 45);
      this.sunSprite.scale.set(s, s, 1);
    }

    /* Sky dome uniforms follow the same real sun. */
    if (this.skyUniforms) {
      this.skyUniforms.uSunDir.value.copy(sunPos).normalize();
      this.skyUniforms.uDayF.value = dayF;
      this.skyUniforms.uHorizonF.value = horizonF * (el > -8 ? 1 : 0);
      this.skyUniforms.uOvercast.value = { clear: 0, cloudy: 0.25, overcast: 0.75, fog: 0.6, rain: 0.6, snow: 0.5, thunder: 0.85 }[this.weatherCondition] ?? 0;
    }

    /* Ground light pools + window materials follow real darkness: invisible
     * in daylight, full glow at night (the daylight-glow bug fix). */
    if (this.poolMat && !this.disposed) this.poolMat.opacity = 0.45 * this._nightF;
    /* Windows shed light outward only at night. */
    if (this.facadeGlows?.length && !this.disposed) {
      const g = 0.34 * this._nightF;
      for (const glow of this.facadeGlows) glow.material.opacity = g;
    }

    /* Flag the on-demand (software-tier) shadow map: lighting just changed. */
    if (this.sun?.shadow && !this.sun.shadow.autoUpdate) this.sun.shadow.needsUpdate = true;
    this._pendingShadowRefresh = true;
  }

  /* --- Live weather integration ------------------------------------------- */
  async _fetchWeather() {
    try {
      const res = await fetch(WEATHER_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.current) {
        try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (_) {}
        return data;
      }
    } catch (_) { /* offline: fall back to cache or time-of-day only */ }
    return null;
  }

  async _initWeather() {
    let data = null;
    try {
      const raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.t < WEATHER_TTL && cached.data?.current) data = cached.data;
      }
    } catch (_) {}
    if (!data) data = await this._fetchWeather();
    if (this.disposed) return;
    this._ingestWeather(data);
    /* Keep the twin live: refresh quietly on the TTL, one timer only. */
    const refresh = async () => {
      if (this.disposed) return;
      this._ingestWeather(await this._fetchWeather());
      if (this.disposed) return;
      this._weatherTimer = setTimeout(refresh, WEATHER_TTL);
    };
    this._weatherTimer = setTimeout(refresh, WEATHER_TTL);
    this._cleanupFns.push(() => clearTimeout(this._weatherTimer));
    /* Minute tick: the sun's real position moves continuously, so re-run the
     * solar engine without waiting for the weather TTL. */
    this._todTimer = setInterval(() => {
      if (this.disposed) return;
      this._applyTimeOfDay();
      this._applyWeatherEnvironment();
    }, 60000);
    this._cleanupFns.push(() => clearInterval(this._todTimer));
  }

  _ingestWeather(data) {
    if (!data?.current) return;
    this.weather = data.current;
    this.weatherCondition = conditionFromCode(
      data.current.weather_code, data.current.snowfall, data.current.precipitation
    );
    this._setWeatherChip();
    this._applyWeatherEnvironment();
  }

  _setWeatherChip() {
    if (!this.weatherChip) return;
    const temp = this.weather && Number.isFinite(this.weather.temperature_2m)
      ? `${Math.round(this.weather.temperature_2m)}°`
      : '—';
    this.weatherChip.innerHTML =
      `<span class="cm3d-weather-icon" aria-hidden="true">${WEATHER_ICONS[this.weatherCondition] || WEATHER_ICONS.clear}</span>` +
      `<span class="cm3d-weather-temp">${temp}</span>`;
    this.weatherChip.dataset.condition = this.weatherCondition;
    this.weatherChip.title = this.weather
      ? `${this.weatherCondition} · ${Math.round(this.weather.temperature_2m)}°C · wind ${Math.round(this.weather.wind_speed_10m)} km/h`
      : 'Live weather unavailable';
  }

  _applyWeatherEnvironment() {
    const env = WEATHER_ENV[this.weatherCondition] || WEATHER_ENV.clear;
    const nightBoost = this._todKeys === 'night' ? 1.3 : 1;
    if (this.scene?.fog) this.scene.fog.density = env.fog * nightBoost;
    if (this.sun && this._todSunI != null) this.sun.intensity = this._todSunI * env.sun;
    if (this.ambient && this._todAmbientI != null) this.ambient.intensity = this._todAmbientI * env.ambient;
    if (this.scene?.fog && this._todFogColor && this._overcastTint && this._tmpFog) {
      if (env.tint > 0) {
        this._tmpFog.lerpColors(this._todFogColor, this._overcastTint, env.tint);
        this.scene.fog.color.copy(this._tmpFog);
        this.renderer?.setClearColor(this._tmpFog, 1);
      } else {
        this.scene.fog.color.copy(this._todFogColor);
        this.renderer?.setClearColor(this._todFogColor, 1);
      }
    }
    const mode = this.weatherCondition === 'snow' ? 'snow'
      : (this.weatherCondition === 'rain' || this.weatherCondition === 'thunder') ? 'rain' : 'none';
    if (mode !== this._particleMode) this._buildParticles(mode);
    if (this.weatherCondition === 'thunder') this._flash = 0.32 + Math.random() * 0.3;

    /* Clouds: dense grey on rain/overcast/thunder/snow, sparse white when
     * clear, hidden at night (stars of the scene go up instead). */
    if (this.cloudMat && this.clouds?.length) {
      const cloudConf = {
        clear: { o: 0.34, c: 0xffffff }, cloudy: { o: 0.5, c: 0xe8edf5 },
        overcast: { o: 0.72, c: 0x9aa4b8 }, fog: { o: 0.4, c: 0xc4cad6 },
        rain: { o: 0.8, c: 0x8b95a9 }, snow: { o: 0.7, c: 0xdfe6f2 },
        thunder: { o: 0.88, c: 0x5d6474 }
      }[this.weatherCondition] || { o: 0.3, c: 0xffffff };
      const nightDim = this._todKeys === 'night' ? 0.3 : this._todKeys === 'dusk' || this._todKeys === 'dawn' ? 0.65 : 1;
      this.cloudMat.opacity = cloudConf.o * nightDim;
      this.cloudMat.color.setHex(cloudConf.c);
    }

    /* Sun glow reacts to condition (handled here so it updates on weather
     * change without waiting for the next minute tick). */
    if (this.sunSprite && this._solarElevation != null) {
      const clarity = { clear: 1, cloudy: 0.45, overcast: 0.12, fog: 0.1, rain: 0.15, snow: 0.3, thunder: 0.08 }[this.weatherCondition] ?? 0.8;
      this.sunSprite.material.opacity = Math.max(0, this._smooth01(this._solarElevation, -2, 12)) * (0.35 + 0.4 * clarity);
    }
    if (this.mount) {
      this.mount.dataset.weatherCondition = this.weatherCondition;
      this.mount.dataset.weatherTemp = this.weather && Number.isFinite(this.weather.temperature_2m)
        ? String(Math.round(this.weather.temperature_2m)) : '';
    }
  }

  /* --- Camera rig + GSAP state machine ------------------------------------ */
  _buildCameraRig() {
    const THREE = this.THREE;
    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 9000);
    this.camTarget = new THREE.Vector3(WORLD.w / 2, 0, WORLD.h / 2);
    this._applyOverview(0);
    /* Cinematic arrival: descend from high above into the overview framing. */
    if (this.gsap) {
      this.sph.dist = 2350; this.sph.pitch = 1.15; this.sph.yaw = Math.PI / 4 + 0.7;
      Object.assign(this.sphCur, this.sph);
      this.gsap.to(this.sph, { dist: this._overviewPose().dist, pitch: this._overviewPose().pitch, yaw: Math.PI / 4, duration: 2.4, ease: 'power3.out' });
    }
  }

  _overviewPose() {
    /* Cinematic 3/4 view (~37 deg elevation). Keeps the user's current
     * bearing — reset eases back to the map center without yaw snap. */
    return { dist: 1560, pitch: 0.65, yaw: this.sph?.yaw ?? Math.PI / 4 };
  }

  _focusPose(mesh) {
    const THREE = this.THREE;
    const box = new THREE.Box3().setFromObject(mesh);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 60);
    return {
      look: sphere.center.clone(),
      dist: r * 3.0,
      pitch: 0.42,                 // lower angle: buildings read tall in frame
      yaw: this.sph.yaw,           // keep the user's bearing
      radius: r
    };
  }

  _applyOverview(duration = 1.1) {
    const pose = this._overviewPose();
    this.camMode = 'overview';
    this.focusId = null;
    this.autoOrbit = true;
    this._tweenCamera(pose, duration);
    this._resetMaterials();
    this._hideFocusRing();
    /* Nothing is selected in overview — the bus-stop route (and its toggle
     * button) belong to a focused building only. */
    this._clearPaths();
    this._updatePathToggleVisibility();
    this._status('Overview. Tap a building to focus — the route from the Bus Stop appears with it.');
  }

  /* The wayfinding toggle only makes sense while a route exists. */
  _updatePathToggleVisibility() {
    if (this.pathBtn) this.pathBtn.classList.toggle('is-hidden', !(this.focusId && this.pathLines.length));
  }

  _focusBuilding(id, duration = 1.15) {
    const mesh = this.meshById.get(id);
    if (!mesh) return;
    this.camMode = 'focus';
    this.focusId = id;
    this.autoOrbit = true;
    this._setFocusMaterial(mesh);
    this._showFocusRing(mesh);
    this._showPathFor(id);
    this._updatePathToggleVisibility();
    this._tweenCamera(this._focusPose(mesh), duration);
    this._status(`${mesh.userData.label} — wayfinding from Bus Stop shown.`);
  }

  _tweenCamera(pose, duration = 1.6) {
    const THREE = this.THREE;
    /* All camera motion goes through the spherical rig: tweens write target
     * values, the loop eases toward them — no competing position tweens. */
    this.gsap.killTweensOf(this.sph);
    this.gsap.killTweensOf(this.camTarget);
    this.gsap.to(this.sph, {
      dist: pose.dist, pitch: pose.pitch, yaw: pose.yaw,
      duration, ease: 'power2.inOut'
    });
    if (pose.look) {
      this.gsap.to(this.camTarget, {
        x: pose.look.x, y: pose.look.y, z: pose.look.z,
        duration, ease: 'power2.inOut'
      });
    } else {
      this.gsap.to(this.camTarget, {
        x: WORLD.w / 2, y: 0, z: WORLD.h / 2,
        duration, ease: 'power2.inOut'
      });
    }
  }

  _setFocusMaterial(mesh) {
    /* Reference look: the selected building turns solid accent; all others
     * stay faint translucent glass. Pure material change — meshes never move
     * or scale, so footprints cannot shift or overlap on focus. */
    for (const m of this.buildingMeshes) {
      const active = m === mesh;
      const mat = m.material;
      if (active) {
        mat.opacity = 1;
        mat.depthWrite = true;
        mat.emissive.set(this.accentHex || 0x7c8cff);
        mat.emissiveIntensity = 0.3;
      } else {
        mat.opacity = 0.18;
        mat.depthWrite = false;
        mat.emissive.set(this.accentHex || 0x7c8cff);
        mat.emissiveIntensity = 0.05;
      }
    }
  }

  _resetMaterials() {
    for (const m of this.buildingMeshes) {
      m.material.opacity = 0.55;
      m.material.depthWrite = false;
      m.material.emissive.set(this.accentHex || 0x7c8cff);
      m.material.emissiveIntensity = 0.05;
    }
  }

  /* Targeting ring that snaps onto the focused building's footprint. */
  _showFocusRing(mesh) {
    const THREE = this.THREE;
    if (!this.focusRing) {
      /* Minimal sonar: one hairline ring in the live accent — no thick
       * donut, no additive glow stack. */
      const g = new THREE.RingGeometry(0.988, 1.0, 72);
      const m = new THREE.MeshBasicMaterial({ color: this.accentHex || PALETTE.path, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      this.focusRing = new THREE.Mesh(g, m);
      this.focusRing.rotation.x = -Math.PI / 2;
      this.focusRing.raycast = () => {};
      this._track(g, m);
      this.scene.add(this.focusRing);
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 30);
    this.focusRing.position.set(sphere.center.x, 1.2, sphere.center.z);
    this.focusRing.visible = true;
    this.focusRing.material.opacity = 0.9;
    if (this.gsap) {
      this.gsap.killTweensOf(this.focusRing.scale);
      this.gsap.fromTo(this.focusRing.scale, { x: r * 0.4, y: r * 0.4, z: r * 0.4 },
        { x: r, y: r, z: r, duration: 0.7, ease: 'power2.out' });
    } else {
      this.focusRing.scale.setScalar(r);
    }
  }

  _hideFocusRing() { if (this.focusRing) this.focusRing.visible = false; }

  /* --- Input: tap select, pinch zoom, pan/orbit override ------------------- */
  _bindEvents() {
    const THREE = this.THREE;
    const el = this.renderer.domElement;
    const pointers = new Map();
    let pinchStart = 0;
    let panStart = null;
    let moved = 0;

    const onPointerDown = (e) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        panStart = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    };
    const onPointerMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) this._zoomBy(pinchStart / d);
        pinchStart = d;
        if (panStart) {
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          this._panBy(cx - panStart.x, cy - panStart.y);
          panStart = { x: cx, y: cy };
        }
        this._userOverride();
      } else if (pointers.size === 1 && moved > 6) {
        this._orbitBy(dx * 0.006);
        this._pitchBy(dy * 0.004);
        this._userOverride();
      }
    };
    const onPointerUp = (e) => {
      const wasTap = moved <= 6 && pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) { pinchStart = 0; panStart = null; }
      if (wasTap) this._pick(e);
    };
    const onWheel = (e) => {
      e.preventDefault();
      this._zoomBy(Math.pow(1.0015, e.deltaY));
      this._userOverride();
    };

    /* Desktop hover: raycast the pointer and lift the hovered building so
     * the scene feels alive under the cursor (skipped on touch — no hover). */
    if (!this.isMobile) {
      const onHover = (e) => {
        if (this.disposed || !this.ready) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointerNdc.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        const hit = this.raycaster.intersectObjects(this.buildingMeshes, false)[0];
        const id = hit ? hit.object.userData.buildingId : null;
        if (id !== this.hoverId) {
          this.hoverId = id;
          for (const m of this.buildingMeshes) {
            const hovered = m.userData.buildingId === id && id !== this.focusId;
            m.material.emissiveIntensity = m.userData.buildingId === this.focusId ? 0.55 : hovered ? 0.3 : 0.08;
          }
          this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
          /* Announce what's under the cursor (screen readers + glanceability).
           * Skip while dragging so the status line isn't thrashing. */
          if (e.buttons === 0) {
            if (id) this._status(`${this.meshById.get(id)?.userData.label || id} — tap to focus.`);
            else if (this.focusId) this._status(`${this.meshById.get(this.focusId)?.userData.label || this.focusId} — wayfinding from Bus Stop shown.`);
            else this._status('Overview. Tap a building to focus — the route from the Bus Stop appears with it.');
          }
        }
      };
      el.addEventListener('pointermove', onHover);
      this._cleanupFns.push(() => el.removeEventListener('pointermove', onHover));
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    this._cleanupFns.push(() => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    });

    const onReset = (e) => { e.stopPropagation(); this._applyOverview(); };
    const onTogglePaths = (e) => {
      e.stopPropagation();
      this.setPathsVisible(!this.pathGroup.visible);
    };
    this.resetBtn.addEventListener('click', onReset);
    this.pathBtn.addEventListener('click', onTogglePaths);
    this._cleanupFns.push(() => {
      this.resetBtn.removeEventListener('click', onReset);
      this.pathBtn.removeEventListener('click', onTogglePaths);
    });

    this._resize();

    /* Responsive scaling: keep aspect + renderer size in sync with the window. */
    this._onWindowResize = () => { if (!this.disposed) this._resize(); };
    window.addEventListener('resize', this._onWindowResize);
    this._cleanupFns.push(() => window.removeEventListener('resize', this._onWindowResize));
  }

  _userOverride() {
    if (this.camMode === 'focus') { this.autoOrbit = false; this.pathBtn.title = 'Manual camera'; }
  }

  _pick(e) {
    const THREE = this.THREE;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.buildingMeshes, false);
    if (hits.length) {
      const id = hits[0].object.userData.buildingId;
      if (id === this.focusId) return;
      this._focusBuilding(id);
    } else if (this.camMode === 'focus') {
      this._applyOverview();
    }
  }

  _zoomBy(factor) {
    const THREE = this.THREE;
    /* Zoom also drives perspective: far = map-like top view, close = street
     * view with a low pitch and wider FOV (depth-of-field feel). */
    this.gsap.killTweensOf(this.sph);
    const d = THREE.MathUtils.clamp(this.sph.dist * factor, 150, 2400);
    const t = (d - 150) / (2400 - 150);
    this.sph.dist = d;
    this.sph.pitch = THREE.MathUtils.lerp(0.2, 0.92, Math.min(1, Math.max(0, t)));
    this._userOverride();
  }

  _panBy(dx, dy) {
    const THREE = this.THREE;
    const dist = this.camera.position.distanceTo(this.camTarget);
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * Math.PI / 180) / 2)) / this.renderer.domElement.clientHeight;
    const right = new THREE.Vector3().subVectors(this.camera.position, this.camTarget)
      .cross(this.camera.up).normalize();
    const fwd = new THREE.Vector3().subVectors(this.camTarget, this.camera.position)
      .setY(0).normalize().multiplyScalar(-1);
    const move = right.multiplyScalar(-dx * worldPerPx).add(fwd.multiplyScalar(dy * worldPerPx));
    this.gsap.killTweensOf(this.camTarget);
    this.camTarget.add(move);
    this.camera.lookAt(this.camTarget);
  }

  /* Damped orbit: pointer input only moves a target angle; the render loop
   * eases the real angle toward it, so drags feel inertial instead of 1:1
   * jittery (spec: custom dampening / lerp loop). */
  _orbitBy(delta) {
    this.gsap.killTweensOf(this.sph);
    this.sph.yaw += delta;
    this._userOverride();
  }

  _pitchBy(delta) {
    const THREE = this.THREE;
    this.gsap.killTweensOf(this.sph);
    this.sph.pitch = THREE.MathUtils.clamp(this.sph.pitch + delta, 0.16, 1.32);
    this._userOverride();
  }

  /* Single easing pass: the live rig chases the target rig every frame, so
   * tweens, drags, zoom and auto-orbit all feel inertial, never rushed. */
  _applyDampedRig(dt) {
    const k = 1 - Math.exp(-dt * 6.5);
    const s = this.sph, c = this.sphCur;
    c.dist += (s.dist - c.dist) * k;
    c.pitch += (s.pitch - c.pitch) * k;
    let dy = s.yaw - c.yaw;
    c.yaw += dy * k;
    const T = this.THREE;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(
      this.camTarget.x + Math.sin(c.yaw) * cp * c.dist,
      this.camTarget.y + sp * c.dist,
      this.camTarget.z + Math.cos(c.yaw) * cp * c.dist
    );
    /* Depth-of-field feel: wider lens up close, tighter from above. */
    const t = Math.min(1, Math.max(0, (c.dist - 150) / (2400 - 150)));
    this.camera.fov = T.MathUtils.lerp(50, 36, t);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camTarget);
  }

  _resize() {
    const w = this.mount.clientWidth || 600;
    const h = this.mount.clientHeight || 420;
    /* Cost scales with pixel count: when the map fills a phone screen in
     * portrait, relax the pixel ratio instead of dropping features. */
    const raw = this.softwareGpu ? 1 : Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.75 : 2);
    const cap = this.isMobile ? 1300000 : 2600000;
    const dpr = w * h * raw > cap ? Math.max(1, cap / (w * h)) : raw;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _startLoop() {
    const tick = (t) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((t - this.lastT) / 1000, 0.05);
      this.lastT = t;
      this.clockUniform.value = t / 1000;
      const tweeningRig = this.gsap.isTweening(this.sph) || this.gsap.isTweening(this.camTarget);
      if (this.autoOrbit && !tweeningRig) {
        /* Focus: slow orbit around the selected building. Overview: the whole
         * world rotates around the map's center (calm showcase spin). */
        this.sph.yaw += (this.camMode === 'focus' ? this.orbitSpeed : 0.03) * dt;
      }
      this._applyDampedRig(dt);
      /* Floating wayfinding arrows glide along the route spline. */
      if (this.routeCurve && this.pathGroup.visible && this.routeArrows.length) {
        const flow = this.clockUniform.value * 0.045;
        for (const a of this.routeArrows) {
          const u = (a.t + flow) % 1;
          this.routeCurve.getPointAt(u, this._tmpA);
          this.routeCurve.getTangentAt(u, this._tmpB);
          a.mesh.position.copy(this._tmpA);
          a.mesh.position.y += 1.5;
          this._tmpA.add(this._tmpB);
          a.mesh.lookAt(this._tmpA);
        }
      }
      /* Pulsing transit halo. */
      if (this.busRing) {
        const s = 1 + 0.05 * Math.sin(this.clockUniform.value * 1.6);
        this.busRing.scale.setScalar(s);
      }
      /* Focused-building ring: a slow, calm sonar sweep. */
      if (this.focusRing?.visible) {
        this.focusRing.material.opacity = 0.42 + 0.16 * Math.sin(this.clockUniform.value * 1.4);
      }
      /* Low clouds drift with the wind. */
      if (this.clouds?.length && this.cloudMat.opacity > 0.01) {
        const w = this.weather ? (this.weather.wind_speed_10m || 8) : 8;
        for (const c of this.clouds) {
          c.position.x += w * 0.55 * dt;
          c.position.z += Math.sin(this.clockUniform.value * 0.05 + c.userData.ph) * 3 * dt;
          if (c.position.x > WORLD.w + 160) c.position.x = -160;
        }
      }
      /* Snow pile-up: depth eases toward full while snowing, melts slowly
       * after; blanket + roof caps fade/rise with depth. */
      if (this.snowBlanketMat) {
        const snowing = this._particleMode === 'snow';
        this.snowDepth = Math.min(1, (this.snowDepth || 0) + (snowing ? dt / 240 : -dt / 300));
        if (this.snowDepth <= 0.001) {
          if (this.snowBlanket.visible) { this.snowBlanket.visible = false; for (const c of this.roofCaps) c.visible = false; }
        } else {
          const lift = this.snowDepth * 5;
          this.snowBlanket.visible = true;
          this.snowBlanketMat.opacity = Math.min(0.85, this.snowDepth * 1.6);
          this.snowBlanket.position.y = 1.1 + lift * 0.4;
          for (const c of this.roofCaps) {
            c.visible = true;
            c.position.y += 0; /* caps ride their building; material carries fade */
          }
        }
      }
      /* Rain wetness: gloss fades in while raining, dries after. */
      if (this.wetMat) {
        const raining = this._particleMode === 'rain';
        this.wetness = Math.min(1, (this.wetness || 0) + (raining ? dt / 20 : -dt / 45));
        if (this.wetness <= 0.001) {
          if (this.wetPlane.visible) { this.wetPlane.visible = false; this.groundMat.roughness = 0.95; this.roadMat.roughness = 0.95; }
        } else {
          this.wetPlane.visible = true;
          this.wetMat.opacity = this.wetness * 0.16;
          /* Wet surfaces are darker + shinier: pull roughness down. */
          this.groundMat.roughness = 0.95 - this.wetness * 0.55;
          this.roadMat.roughness = 0.95 - this.wetness * 0.6;
        }
      }
      /* Nightlife: random windows toggle on/off on their own timers. All
       * windows of one building share one InstancedMesh (1 draw call), so a
       * toggle is just an instance-color write. */
      if (this._nightWindows?.length) {
        /* Window intensity tracks real darkness (_nightF): off in daylight,
         * smooth ramp through twilight, full glow at night. */
        /* Day: only a faint glass hint (no emission). Night: full emissive
         * blast per window — bloom picks it up as halos. */
        const nf = this._nightF ?? 0;
        const base = 0.12 + 0.88 * nf;
        const emissiveI = 0.05 + 1.55 * nf;
        const t = this.clockUniform.value;
        const col = this._nightCol || (this._nightCol = new this.THREE.Color());
        for (const b of this._nightWindows) {
          b.wm.emissiveIntensity = emissiveI;
          if (nf > 0.02) {
            let dirty = false;
            b.timers.forEach((timer, i) => {
              if (t > Math.abs(timer)) {
                b.cells[i].on = timer < 0 ? b.cells[i].on : !b.cells[i].on;
                b.timers[i] = (b.cells[i].on ? -1 : 1) * (t + 10 + Math.random() * 34);
                dirty = true;
              }
            });
            if (dirty) {
              b.cells.forEach((c, i) => {
                col.setHex(c.on ? c.tint : 0x10141f);
                b.inst.setColorAt(i, col);
              });
              b.inst.instanceColor.needsUpdate = true;
            }
          }
          if (Math.abs(b.wm.opacity - base) > 0.01) {
            b.wm.opacity += (base - b.wm.opacity) * Math.min(1, dt * 4);
          }
        }
      }
      /* Bloom breathes gently so the neon never looks like a static overlay. */
      if (this.bloomPass) {
        const night = this._todKeys === 'night' ? 1.35 : this._todKeys === 'dusk' ? 1.1 : 1;
        this.bloomPass.strength = this._bloomBase * night * (1 + 0.07 * Math.sin(this.clockUniform.value * 1.6));
      }
      /* Storm flashes: rapid flicker with a hard decay, re-striking every
       * few seconds while the storm cell is overhead. */
      if (this.lightning) {
        if (this._flash > 0) {
          this._flash -= dt;
          this.lightning.intensity = 2.6 * Math.max(0, Math.sin(this._flash * 40)) * Math.min(1, this._flash * 6);
        } else {
          if (this.lightning.intensity !== 0) this.lightning.intensity = 0;
          if (this.weatherCondition === 'thunder' && Math.random() < dt / 5) this._flash = 0.32 + Math.random() * 0.3;
        }
      }
      /* Keep the sky dome centered on the orbit target: the horizon never
       * drifts as the camera moves. */
      if (this.sky) this.sky.position.set(this.camTarget.x, 0, this.camTarget.z);
      this._animateParticles(dt);
      this._render();
    };
    this._tick = tick;
    this.raf = requestAnimationFrame(tick);
    /* Battery & thermal guard: stop the RAF while the tab is hidden. */
    this._onVisibility = () => {
      if (this.disposed) return;
      if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; }
      else if (!this.raf) { this.lastT = performance.now(); this.raf = requestAnimationFrame(this._tick); }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._cleanupFns.push(() => document.removeEventListener('visibilitychange', this._onVisibility));
  }

  _render() {
    /* Composer when available (bloom), direct render as the safe fallback. */
    if (this.composer && !this.disposed) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _status(msg) {
    this.opts.onStatus && this.opts.onStatus(msg);
    this.mount.dataset.cameraMode = this.camMode;
    this.mount.dataset.focusBuilding = this.focusId || '';
    this.mount.dataset.pathSegments = String(this.pathLines?.length || 0);
  }

  _track(geo, mat) {
    this._geos = this._geos || [];
    this._mats = this._mats || [];
    if (geo) this._geos.push(geo);
    if (mat) this._mats.push(mat);
  }

  /* --- Live theme support ---------------------------------------------------
   * Re-read --accent and re-tint every accent-derived color: glass bodies,
   * selection emissive, sky accent, light pools. */
  refreshAccent() {
    if (this.disposed || !this.THREE) return;
    const css = (typeof getComputedStyle === 'function')
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      : '';
    const hex = css || this.opts.accentColor || '#7c8cff';
    this.accentColor = hex;
    this.accentHex = new this.THREE.Color(hex);
    /* Re-tint every glass body to the live accent, then restore the exact
     * focus-state treatment (solid selected / translucent 0.18 others /
     * default 0.55 glass) so a theme switch never disturbs selection. */
    for (const m of this.buildingMeshes) {
      m.material.color.set(this.accentHex).lerp(new this.THREE.Color(0xffffff), 0.18);
      m.material.emissive.set(this.accentHex);
      m.userData.baseColor = this.accentHex.getHex();
    }
    const focused = this.focusId ? this.meshById.get(this.focusId) : null;
    if (focused) this._setFocusMaterial(focused);
    else this._resetMaterials();
    if (this.skyUniforms) this.skyUniforms.uAccent.value.copy(this.accentHex);
    if (this.poolMat) this.poolMat.color.set(this.accentHex).lerp(new this.THREE.Color(0xffc27a), 0.5);
    if (this.focusRing) this.focusRing.material.color.set(this.accentHex);
  }

  /* --- Public API ---------------------------------------------------------- */
  focus(id) { if (this.ready) this._focusBuilding(id); }

  reset() { if (this.ready) this._applyOverview(); }

  resize() { if (this.ready) this._resize(); }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    /* Particles stay in the scene: the traverse below disposes their geometry
     * and material. */
    this.routeArrows = [];
    this.routeCurve = null;
    if (this.gsap) this.gsap.killTweensOf([this.camera?.position, this.camTarget].filter(Boolean));
    for (const fn of this._cleanupFns) { try { fn(); } catch (_) {} }
    this._cleanupFns = [];
    this._clearPaths();
    for (const g of this._geos || []) g.dispose();
    for (const m of this._mats || []) m.dispose();
    this.scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mm) => mm.dispose());
      }
    });
    this._spriteTex?.dispose();
    this.composer?.dispose?.();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.hud?.remove();
    for (const m of this._owned || []) m.parent?.remove(m);
    this._owned = [];
    this.windowGlow = [];
    this.weatherChip?.remove();
    this.ready = false;
  }
}
