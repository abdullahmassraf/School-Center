/* =========================================================================
   CAMPUS MAP WIDGET — Davis Campus (3D digital twin)
   ---------------------------------------------------------------------------
   Traced from the official Davis Campus map (Steeles Ave W / McLaughlin Road
   site). Building footprints are real polygon outlines rather than generic
   rectangles; the interactive 3D scene in src/campus-map-3d.js extrudes them.

   The legacy 2D SVG plan has been removed from the app entirely: the 3D map
   IS the campus map. When WebGL or the Three.js CDN is genuinely unavailable,
   a graceful message is shown instead of the old flat plan.

   Design rules for this widget (keep them if you edit it):
     - No emoji anywhere. Labels are text, markers are vector shapes.
     - Fonts inherit from the app (set in style.css via `font-family: inherit`).
     - Colour comes only from app tokens (--accent / --ink / --muted).
     - Geometry lives here; every visual choice lives in style.css.

   Coordinate space: SVG "0 0 930 1000", mapped 1:1 into world units by the
   3D scene (SVG X -> world X, SVG Y -> world Z). If you re-trace from the
   original map, keep that transform so existing coordinates stay valid.
   ========================================================================= */

/* Active CampusMap3DManager, if any. */
let campus3dManager = null;
let campus3dBootPromise = null;

/* --- Buildings -----------------------------------------------------------
   `d`     footprint path (real outline, extruded by the 3D scene)
   `label` long name used in status text                                    */
export const CAMPUS_BUILDINGS = {
  J: {
    label: 'Building J',
    d: 'M 388 84 L 437 84 L 437 150 L 428 150 L 428 208 L 400 208 L 400 176 L 374 176 L 374 142 L 388 142 Z'
  },
  H: {
    label: 'Building H',
    d: 'M 382 208 L 402 208 L 402 230 L 478 230 L 478 268 L 462 268 L 462 330 L 440 330 L 440 366 L 372 366 L 372 300 L 382 300 Z'
  },
  M: {
    label: 'Building M',
    d: 'M 98 476 L 118 476 L 118 468 L 300 468 L 300 484 L 318 484 L 318 500 L 118 500 L 118 492 L 98 492 Z'
  },
  B: {
    label: 'Building B — Main Entrance',
    d: 'M 372 486 L 470 486 L 470 506 L 524 506 L 524 542 L 584 542 L 584 604 L 540 604 L 540 644 L 502 644 L 502 686 L 442 686 L 442 646 L 402 646 L 402 604 L 358 604 L 358 542 L 372 542 Z'
  },
  C: {
    label: 'Building C — Gymnasium',
    d: 'M 646 540 L 792 540 L 792 600 L 762 600 L 762 632 L 646 632 L 646 596 L 664 596 L 664 572 L 646 572 Z'
  },
  A: {
    label: 'Building A',
    d: 'M 612 640 L 762 640 L 762 662 L 820 662 L 820 742 L 792 742 L 792 802 L 632 802 L 612 762 Z'
  }
};

/* --- Parking -------------------------------------------------------------- */
const PARKING_LOTS = [
  { id: 'lot-6', label: 'Lot 6', x: 156, y: 174, w: 148, h: 126 },
  { id: 'lot-5', label: 'Lot 5', x: 156, y: 336, w: 148, h: 114 },
  { id: 'lot-4', label: 'Staff Lot 4', x: 156, y: 514, w: 184, h: 116 },
  { id: 'lot-3', label: 'Visitor Parking', sub: 'Lot 3', x: 332, y: 780, w: 128, h: 194 },
  { id: 'lot-2', label: 'Lot 2', x: 466, y: 780, w: 136, h: 102 },
  { id: 'lot-1', label: 'Lot 1', x: 608, y: 810, w: 252, h: 106 }
];

const SHUTTLE_STOP = { x: 376, y: 450 };

/** First letter of a room string ("C328" -> "C"). Returns null for
 *  non-physical rooms ("Online (VTL)") or unknown buildings. */
export function getBuildingIdForRoom(room) {
  if (!room) return null;
  const m = String(room).trim().match(/^([A-Za-z])/);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return CAMPUS_BUILDINGS[code] ? code : null;
}

/** Inline "Show location" control for any class/session with a real room.
 *  Returns '' when the room has no building, so callers can splice it in
 *  without an extra conditional. No emoji — a vector pin glyph instead. */
export function renderShowLocationButton(room, extraStyle = '') {
  const buildingId = getBuildingIdForRoom(room);
  if (!buildingId) return '';
  return `<button class="cm-show-location-btn" data-show-location="${buildingId}" type="button" style="${extraStyle}" title="Show ${buildingId} on the campus map">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>` +
    `<span>Show location</span></button>`;
}

export function renderCampusMapWidget() {
  /* The interactive 3D digital twin IS the campus map — no 2D plan exists
   * anymore. The no-WebGL fallback below is a message, not a flat map. */
  const stage3d = `
      <div class="cm-stage-3d" id="cm-stage-3d">
        <div class="cm3d-mount" id="cm3d-mount" aria-label="Interactive 3D map of Davis Campus"></div>
        <div class="cm3d-loading" id="cm3d-loading">Loading 3D campus…</div>
      </div>`;

  const head = `
    <div class="panel campus-map-card" id="campus-map-card">
      <div class="cm-head">
        <div class="cm-head-copy">
          <h3 class="headfont">Campus Map</h3>
          <p class="cm-status" id="cm-status-text">Davis Campus. Select a building, or use Show location on a class.</p>
        </div>
      </div>`;

  /* Quick building selectors (mock-up parity): one tap focuses a building
   * and shows its bus-stop route — no hunting through the 3D scene. */
  const chips = `
      <div class="cm-chip-row" role="group" aria-label="Quick building selection">
        ${Object.entries(CAMPUS_BUILDINGS).map(([id, b]) =>
          `<button class="cm-chip" data-map-chip="${id}" type="button" title="Focus ${b.label}">${id}</button>`).join('')}
      </div>`;

  return head + chips + stage3d + `</div>`;
}

export function highlightBuilding(buildingId) {
  const card = document.getElementById('campus-map-card');
  const target = CAMPUS_BUILDINGS[buildingId];
  if (!card || !target) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /* Active 3D scene takes precedence: camera flies to the building and the
   * wayfinding path animates in. */
  if (campus3dManager && campus3dManager.ready) {
    campus3dManager.focus(buildingId);
    const s = document.getElementById('cm-status-text');
    if (s) s.textContent = `Showing ${target.label}.`;
    return;
  }
  if (!campus3dManager) {
    /* 3D still booting: remember the request and apply it once ready. */
    pendingFocus3d = buildingId;
  }
}

export function clearCampusHighlight() {
  if (campus3dManager) campus3dManager.reset();
  const statusText = document.getElementById('cm-status-text');
  if (statusText) statusText.textContent = 'Davis Campus. Select a building, or use Show location on a class.';
}

/** Boot the 3D manager inside the current widget. Safe to call on every
 *  render: skips when absent, tears down any stale instance whose mount
 *  point disappeared, and falls back to an honest message (never the old
 *  2D map) when WebGL/the CDN is unavailable. */
export async function initCampusMap3d() {
  const card = document.getElementById('campus-map-card');
  if (!card) {
    /* Widget left the DOM (navigated away) — stop the render loop. */
    disposeCampusMap3d();
    return;
  }
  const stage = document.getElementById('cm-stage-3d');
  const mount = document.getElementById('cm3d-mount');
  if (!stage || !mount) return;

  /* A previous render's manager is stale (its mount was replaced) — dispose. */
  if (campus3dManager && campus3dManager.mount !== mount) {
    campus3dManager.dispose();
    campus3dManager = null;
  }
  if (campus3dManager) return;

  const loading = document.getElementById('cm3d-loading');
  let manager = null;
  try {
    const { CampusMap3DManager } = await import('./campus-map-3d.js');
    if (!mount.isConnected) return;
    /* Publish the instance before awaiting CDN imports so a second render
     * cannot start a duplicate renderer while the first one is booting. */
    manager = new CampusMap3DManager(mount, {
      accentColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c8cff',  // eslint-disable-line
      getBuildings: () => CAMPUS_BUILDINGS,
      /* Real traced site data: lots and the shuttle stop come from the same
       * source of truth as the building footprints. */
      getInfrastructure: () => ({
        lots: PARKING_LOTS,
        shuttleStop: [SHUTTLE_STOP.x, SHUTTLE_STOP.y]
      }),
      onStatus: (msg) => {
        const s = document.getElementById('cm-status-text');
        if (s) s.textContent = msg;
      }
    });
    campus3dManager = manager;
    campus3dBootPromise = manager.init();
    const ok = await campus3dBootPromise;
    /* Local-only inspection hook used by the dedicated browser harness. It
     * never exists on the deployed site and lets the harness calculate a
     * projected building hit point without hard-coding screen coordinates. */
    if (location.hostname === '127.0.0.1') window.__SC_CAMPUS_MAP_3D__ = manager;
    if (loading) loading.remove();
    if (ok && campus3dManager === manager) {
      manager.resize();
      /* Re-apply any pending Show-location focus through the 3D scene. */
      if (pendingFocus3d) {
        manager.focus(pendingFocus3d);
        pendingFocus3d = null;
      }
    } else if (campus3dManager === manager && mount.isConnected) {
      throw new Error('3D init failed');
    }
  } catch (err) {
    /* A stale manager can finish after a reactive render replaced its mount.
     * It must not disable the current 3D instance or alter the new UI. */
    if (campus3dManager !== manager || !mount.isConnected) {
      manager?.dispose();
      return;
    }
    console.warn('[campus-3d] unavailable:', err && (err.stack || err.message));
    campus3dManager = null;
    manager?.dispose();
    show3dUnavailable(stage);
    const s = document.getElementById('cm-status-text');
    if (s) s.textContent = '3D campus map unavailable on this device.';
  }
}

/** No-WebGL fallback: an honest glass message. The legacy 2D SVG plan was
 *  removed from the app, so there is no flat map to reveal anymore. */
function show3dUnavailable(stage) {
  if (!stage || document.getElementById('cm3d-unavailable')) return;
  const msg = document.createElement('div');
  msg.className = 'cm3d-unavailable';
  msg.id = 'cm3d-unavailable';
  msg.setAttribute('role', 'status');
  msg.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>
    </svg>
    <p><strong>3D campus map unavailable</strong></p>
    <p>This device or browser can't run WebGL right now, so the interactive 3D map can't render. Try a current version of Chrome, Edge, Firefox or Safari.</p>`;
  const loading = document.getElementById('cm3d-loading');
  if (loading) loading.remove();
  stage.appendChild(msg);
}

/* Building requested via Show location before the 3D scene finished booting. */
let pendingFocus3d = null;

/* Theme changed: re-tint the live 3D scene from the new --accent. */
export function refreshCampusMapAccent() {
  if (campus3dManager?.ready) {
    try { campus3dManager.refreshAccent(); } catch (_) { /* non-fatal */ }
  }
}

export function disposeCampusMap3d() {
  if (campus3dManager) {
    campus3dManager.dispose();
    if (location.hostname === '127.0.0.1') delete window.__SC_CAMPUS_MAP_3D__;
    campus3dManager = null;
  }
}
