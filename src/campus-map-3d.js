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
 * Real-clock phases (dawn / midday / dusk / night) grade the sun, ambient
 * light and fog color. No sliders: the environment simply follows the hour
 * and cross-fades across phase boundaries. */
const TOD_PHASES = {
  night:  { fog: 0x0b1030, ambient: 0x44508f, ambientI: 0.42, sun: 0x93a7ff, sunI: 0.55, sunPos: [-320, 520, -180] },
  dawn:   { fog: 0x241c3f, ambient: 0x9a7aa0, ambientI: 0.58, sun: 0xffb27a, sunI: 0.95, sunPos: [-520, 300, 340] },
  midday: { fog: 0x101735, ambient: 0xcdd6ff, ambientI: 0.6,  sun: 0xffffff, sunI: 1.35, sunPos: [420, 700, 260] },
  dusk:   { fog: 0x1f1a44, ambient: 0x8a72b0, ambientI: 0.55, sun: 0xff9a6a, sunI: 0.85, sunPos: [560, 260, 440] }
};
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
    this._tmpA = null;
    this._tmpB = null;
    this._geos = [];
    this._mats = [];
  }

  async init() {
    const [threeModule, { SVGLoader }, gsapModule] = await Promise.all([
      import('three'),
      import('three/addons/loaders/SVGLoader.js'),
      import('gsap')
    ]);
    if (this.disposed) return false;
    this.SVGLoader = SVGLoader;
    /* Browser ESM builds expose Three.js as a namespace, while GSAP exposes
     * its API as either a default export or a namespace depending on the CDN
     * / bundler. Normalize both shapes before constructing the renderer. */
    const THREE = threeModule.default || threeModule;
    const gsap = gsapModule.default || gsapModule.gsap || gsapModule;
    this.THREE = THREE;
    this.gsap = gsap;
    this.loader = new SVGLoader();

    this._buildRenderer();
    this._buildScene();
    this._buildLights();
    this._buildGround();
    this._buildInfrastructure();
    this._buildBuildings();
    this._buildGraph();
    this._buildCameraRig();
    this._showPathFor('J');
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'cm3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D campus map');
    this.renderer.domElement.setAttribute('role', 'img');
    this.mount.appendChild(this.renderer.domElement);

    this.info = null;
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

    this.sun = new THREE.DirectionalLight(0xffffff, 1.35);
    this.sun.position.set(420, 700, 260);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -620;
    this.sun.shadow.camera.right = 620;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.near = 80;
    this.sun.shadow.camera.far = 1900;
    this.sun.shadow.bias = -0.00045;          // z-fighting guard per spec
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
  }

  _buildGround() {
    const THREE = this.THREE;
    const g = new THREE.CircleGeometry(468, 72);
    const m = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95, metalness: 0.05 });
    this.ground = new THREE.Mesh(g, m);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(WORLD.w / 2, -0.4, WORLD.h / 2);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this._track(g, m);

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
        bevelSegments: 2
      });
      const mat = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: 0.55,
        metalness: 0.15,
        emissive: new THREE.Color(style.color).multiplyScalar(0.08)
      });
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
        uFocus: { value: 0 }
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
        varying float vDist;
        void main() {
          float dash = 26.0;
          float flow = fract((vDist - uTime * 90.0) / dash);
          float arrow = smoothstep(0.0, 0.35, flow) * (1.0 - smoothstep(0.55, 1.0, flow));
          float alpha = uOpacity * (0.35 + 0.65 * arrow);
          alpha *= mix(1.0, 1.15, uFocus);
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
    const conf = mode === 'rain'
      ? { n: 700, size: 2.0, opacity: 0.5, color: 0x9fd8ff, speed: [260, 380] }
      : { n: SNOW_COUNT, size: 3.4, opacity: 0.62, color: 0xdfe8ff, speed: [22, 56] };
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
    const mat = new THREE.PointsMaterial({
      color: conf.color, size: conf.size, transparent: true, opacity: conf.opacity,
      sizeAttenuation: true, depthWrite: false, fog: true
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.raycast = () => {};
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this._snowData = { phases, speeds, mode };
  }

  _animateParticles(dt) {
    if (!this.snow || this.disposed || this._particleMode === 'none') return;
    const pos = this.snow.geometry.getAttribute('position');
    const { phases, speeds, mode } = this._snowData;
    const t = this.clockUniform.value;
    if (mode === 'rain') {
      /* Rain falls fast with a steady wind slant; flakes recycle at the top. */
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - speeds[i] * dt;
        let x = pos.getX(i) + 16 * dt;
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
  _todPhaseForHour(h) {
    if (h >= 6 && h < 10) return 'dawn';
    if (h >= 10 && h < 17) return 'midday';
    if (h >= 17 && h < 21) return 'dusk';
    return 'night';
  }

  _applyTimeOfDay() {
    const phaseKey = this._todPhaseForHour(new Date().getHours());
    const phase = TOD_PHASES[phaseKey];
    const THREE = this.THREE;
    this.ambient.color.setHex(phase.ambient);
    this.ambient.intensity = phase.ambientI;
    this.sun.color.setHex(phase.sun);
    this.sun.intensity = phase.sunI;
    this.sun.position.set(...phase.sunPos);
    this.scene.fog.color.setHex(phase.fog);
    if (this.renderer) this.renderer.setClearColor(phase.fog, 1);
    this._todKeys = phaseKey;
    /* Bases the live-weather grader modulates on top of. */
    this._todSunI = phase.sunI;
    this._todAmbientI = phase.ambientI;
    this._todFogColor = this._todFogColor || new THREE.Color();
    this._todFogColor.setHex(phase.fog);
    this._overcastTint = this._overcastTint || new THREE.Color(0x8a94a8);
    this._tmpFog = this._tmpFog || new THREE.Color();
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
    if (this.mount) {
      this.mount.dataset.weatherCondition = this.weatherCondition;
      this.mount.dataset.weatherTemp = this.weather && Number.isFinite(this.weather.temperature_2m)
        ? String(Math.round(this.weather.temperature_2m)) : '';
    }
  }

  /* --- Camera rig + GSAP state machine ------------------------------------ */
  _buildCameraRig() {
    const THREE = this.THREE;
    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 4200);
    this.camTarget = new THREE.Vector3(WORLD.w / 2, 0, WORLD.h / 2);
    this._applyOverview(0);
  }

  _overviewPose() {
    const c = this.camTarget;
    return {
      /* Slightly oblique rather than perfectly flat: this keeps the overview
       * readable as a spatial map while preserving the mock-up's calm framing. */
      pos: new (this.THREE.Vector3)(c.x, 1040, c.z + 620),
      look: c.clone()
    };
  }

  _focusPose(mesh) {
    const THREE = this.THREE;
    const box = new THREE.Box3().setFromObject(mesh);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const c = sphere.center;
    const r = Math.max(sphere.radius, 60);
    const d = r * 3.1;
    /* ~45° from horizontal; keep a consistent compass bearing. */
    const yaw = this.orbitAngle;
    const pos = new THREE.Vector3(
      c.x + Math.sin(yaw) * d * 0.9,
      c.y + d * 0.95,
      c.z + Math.cos(yaw) * d * 0.9
    );
    return { pos, look: c.clone(), radius: r };
  }

  _applyOverview(duration = 1.1) {
    const pose = this._overviewPose();
    this.camMode = 'overview';
    this.focusId = null;
    this.autoOrbit = true;
    this._tweenCamera(pose, duration);
    this._setFocusMaterial(null);
    this._status('Overview. Tap a building to focus.');
  }

  _focusBuilding(id, duration = 1.15) {
    const mesh = this.meshById.get(id);
    if (!mesh) return;
    this.camMode = 'focus';
    this.focusId = id;
    this.autoOrbit = true;
    this._setFocusMaterial(mesh);
    this._showPathFor(id);
    this._tweenCamera(this._focusPose(mesh), duration);
    this._status(`${mesh.userData.label} — wayfinding from Bus Stop shown.`);
  }

  _tweenCamera(pose, duration) {
    const THREE = this.THREE;
    const from = this.camera.position.clone();
    const lookFrom = this.camTarget.clone();
    this.gsap.killTweensOf(this.camera.position);
    this.gsap.killTweensOf(this.camTarget);
    this.gsap.to(this.camera.position, {
      x: pose.pos.x, y: pose.pos.y, z: pose.pos.z,
      duration, ease: 'power3.inOut',
      onUpdate: () => this.camera.updateMatrixWorld()
    });
    this.gsap.to(this.camTarget, {
      x: pose.look.x, y: pose.look.y, z: pose.look.z,
      duration, ease: 'power3.inOut',
      onUpdate: () => this.camera.lookAt(this.camTarget)
    });
  }

  _setFocusMaterial(mesh) {
    for (const m of this.buildingMeshes) {
      const active = m === mesh;
      m.material.emissive.setHex(active ? 0x2a2350 : m.userData.baseColor);
      m.material.emissiveIntensity = active ? 0.55 : 0.08;
      m.scale.setScalar(active ? 1.06 : 1);
    }
  }

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
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.camTarget);
    const len = THREE.MathUtils.clamp(dir.length() * factor, 240, 2400);
    dir.setLength(len);
    this.gsap.killTweensOf(this.camera.position);
    this.camera.position.copy(this.camTarget).add(dir);
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
    this.orbitTarget = (this.orbitTarget == null ? this.orbitAngle : this.orbitTarget) + delta;
    this._userOverride();
  }

  _applyDampedOrbit(dt) {
    if (this.orbitTarget == null || Math.abs(this.orbitTarget - this.orbitAngle) < 0.0004) return;
    this.orbitAngle += (this.orbitTarget - this.orbitAngle) * Math.min(1, dt * 9);
    const c = this.camTarget;
    const d = this.camera.position.distanceTo(c);
    const horizontal = Math.max(Math.hypot(this.camera.position.x - c.x, this.camera.position.z - c.z), 1);
    const pitch = Math.atan2(this.camera.position.y - c.y, horizontal);
    const hr = d * Math.cos(pitch);
    this.camera.position.set(
      c.x + Math.sin(this.orbitAngle) * hr,
      c.y + d * Math.sin(pitch),
      c.z + Math.cos(this.orbitAngle) * hr
    );
    this.camera.lookAt(c);
  }

  _resize() {
    const w = this.mount.clientWidth || 600;
    const h = this.mount.clientHeight || 420;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 520 ? 46 : 38;
    this.camera.updateProjectionMatrix();
  }

  _startLoop() {
    const tick = (t) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((t - this.lastT) / 1000, 0.05);
      this.lastT = t;
      this.clockUniform.value = t / 1000;
      if (this.autoOrbit && this.camMode === 'focus' && !this.gsap.isTweening(this.camera.position)) {
        this.orbitAngle += this.orbitSpeed * dt;
        this.orbitTarget = this.orbitAngle;
        const mesh = this.focusId ? this.meshById.get(this.focusId) : null;
        if (mesh) {
          const pose = this._focusPose(mesh);
          const k = 0.08;
          this.camera.position.lerp(pose.pos, k);
          this.camTarget.lerp(pose.look, k);
          this.camera.lookAt(this.camTarget);
        }
      }
      this._applyDampedOrbit(dt);
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
        const s = 1 + 0.14 * Math.sin(this.clockUniform.value * 2.4);
        this.busRing.scale.setScalar(s);
      }
      this._animateParticles(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
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
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.hud?.remove();
    this.weatherChip?.remove();
    this.ready = false;
  }
}
