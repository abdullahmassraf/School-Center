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
  ['aEnt', 'cEnt'], ['rEnt', 'cEnt']
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
    this._geos = [];
    this._mats = [];
  }

  async init() {
    const [{ default: THREE }, { SVGLoader }, { default: gsap }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/SVGLoader.js'),
      import('gsap')
    ]);
    if (this.disposed) return false;
    this.THREE = THREE;
    this.gsap = gsap;
    this.loader = new SVGLoader();

    this._buildRenderer();
    this._buildScene();
    this._buildLights();
    this._buildGround();
    this._buildBuildings();
    this._buildGraph();
    this._buildCameraRig();
    this._showPathFor('J');
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

    this.info = document.createElement('div');
    this.info.className = 'cm3d-info';
    this.info.innerHTML = `
      <div class="cm3d-info-tag"><span class="cm3d-pulse"></span><span class="cm3d-info-kicker">CAMPUS MAP</span></div>
      <strong class="cm3d-info-title">Davis Campus Overview</strong>
      <span class="cm3d-info-copy">Select a building to inspect its 3D footprint and walkable route.</span>
      <span class="cm3d-info-route">Routes begin at the Shuttle Bus stop</span>`;
    this.mount.appendChild(this.info);

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
    this.infoTitle = this.info.querySelector('.cm3d-info-title');
    this.infoCopy = this.info.querySelector('.cm3d-info-copy');
    this.infoRoute = this.info.querySelector('.cm3d-info-route');
  }

  _buildScene() {
    const THREE = this.THREE;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(PALETTE.ground, 1400, 2600);

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();

    this.buildingMeshes = [];
    this.meshById = new Map();
    this.pathGroup = new THREE.Group();
    this.pathGroup.visible = true;
    this.scene.add(this.pathGroup);
    this.pathLines = [];
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

  /* --- Buildings via SVGLoader -> ExtrudeGeometry ------------------------- */
  _shapesFromPath(d) {
    const parsed = this.loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
    return parsed.paths.flatMap((p) => SVGLoader_createShapes(p));
    function SVGLoader_createShapes(p) { return SVGLoader.createShapes(p); }
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
  }

  _clearPaths() {
    for (const { line, mat } of (this.pathLines || [])) {
      this.pathGroup.remove(line);
      line.geometry.dispose();
      if (mat) mat.dispose();
    }
    this.pathLines = [];
    if (this.pathPucks) {
      for (const p of this.pathPucks) this.pathGroup.remove(p);
      this.pathPucks = null;
    }
  }

  setPathsVisible(v) {
    this.pathGroup.visible = v;
    this.pathBtn.classList.toggle('is-off', !v);
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

  _orbitBy(delta) {
    this.orbitAngle += delta;
    const c = this.camTarget;
    const d = this.camera.position.distanceTo(c);
    if (this.camMode === 'focus') {
      const horizontal = Math.max(Math.hypot(this.camera.position.x - c.x, this.camera.position.z - c.z), 1);
      const pitch = Math.atan2(this.camera.position.y - c.y, horizontal);
      const horizontalRadius = d * Math.cos(pitch);
      this.camera.position.set(
        c.x + Math.sin(this.orbitAngle) * horizontalRadius,
        c.y + d * Math.sin(pitch),
        c.z + Math.cos(this.orbitAngle) * horizontalRadius
      );
      this.camera.lookAt(c);
    } else {
      this.camera.position.set(
        c.x + Math.sin(this.orbitAngle) * d * 0.35,
        this.camera.position.y,
        c.z + Math.cos(this.orbitAngle) * d * 0.35
      );
      this.camera.lookAt(c);
    }
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
        const mesh = this.focusId ? this.meshById.get(this.focusId) : null;
        if (mesh) {
          const pose = this._focusPose(mesh);
          const k = 0.08;
          this.camera.position.lerp(pose.pos, k);
          this.camTarget.lerp(pose.look, k);
          this.camera.lookAt(this.camTarget);
        }
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  _status(msg) {
    this.opts.onStatus && this.opts.onStatus(msg);
    if (!this.infoTitle || !this.infoCopy || !this.infoRoute) return;
    if (this.camMode === 'focus' && this.focusId) {
      const label = this.meshById.get(this.focusId)?.userData.label || `Building ${this.focusId}`;
      this.infoTitle.textContent = label;
      this.infoCopy.textContent = 'Interactive 3D focus with an animated walkable route.';
      this.infoRoute.textContent = 'Route from Shuttle Bus · Tap Reset for overview';
      this.info.querySelector('.cm3d-info-kicker').textContent = `FOCUSED · ${this.focusId}`;
    } else {
      this.infoTitle.textContent = 'Davis Campus Overview';
      this.infoCopy.textContent = 'Select a building to inspect its 3D footprint and walkable route.';
      this.infoRoute.textContent = 'Routes begin at the Shuttle Bus stop';
      this.info.querySelector('.cm3d-info-kicker').textContent = 'CAMPUS MAP';
    }
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
    this.info?.remove();
    this.ready = false;
  }
}
