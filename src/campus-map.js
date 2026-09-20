/* =========================================================================
   CAMPUS MAP WIDGET — Davis Campus
   ---------------------------------------------------------------------------
   Traced from the official Davis Campus map (Steeles Ave W / McLaughlin Road
   site). Building footprints are real polygon outlines rather than generic
   rectangles, and the whole plan is rendered inside a circular cutout.

   Design rules for this widget (keep them if you edit it):
     - No emoji anywhere. Labels are text, markers are vector shapes.
     - Fonts inherit from the app (set in style.css via `font-family: inherit`).
     - Colour comes only from app tokens (--accent / --ink / --muted).
     - Geometry lives here; every visual choice lives in style.css.

   Coordinate space: viewBox "0 0 930 1000", derived from the source artwork by
   x' = (x_src - 150) * 1.176, y' = (y_src - 155) * 1.176. If you re-trace from
   the original map, keep that transform so existing coordinates stay valid.
   ========================================================================= */

export const CAMPUS_VIEWBOX = { w: 930, h: 1000 };

/* 3D mode preference survives renders; defaults ON, auto-falls back to the
 * SVG plan when WebGL or the Three.js CDN is unavailable. */
let campusMode3d = true;
let campus3dManager = null; // active CampusMap3DManager, if any
let campus3dBootPromise = null;
export function isCampus3dActive() { return campusMode3d; }

/* Circular cutout: everything outside this circle is clipped away. */
const CUTOUT = { cx: 465, cy: 500, r: 462 };

/* --- Buildings -----------------------------------------------------------
   `d`     footprint path
   `label` long name used in status text
   `badge` where the lettered pill sits
   `pin`   where the location marker drops (top-centre of the footprint)   */
export const CAMPUS_BUILDINGS = {
  J: {
    label: 'Building J',
    d: 'M 388 84 L 437 84 L 437 150 L 428 150 L 428 208 L 400 208 L 400 176 L 374 176 L 374 142 L 388 142 Z',
    badge: { x: 412, y: 130 },
    pin: { x: 412, y: 78 }
  },
  H: {
    label: 'Building H',
    d: 'M 382 208 L 402 208 L 402 230 L 478 230 L 478 268 L 462 268 L 462 330 L 440 330 L 440 366 L 372 366 L 372 300 L 382 300 Z',
    badge: { x: 423, y: 288 },
    pin: { x: 423, y: 226 }
  },
  M: {
    label: 'Building M',
    d: 'M 98 476 L 118 476 L 118 468 L 300 468 L 300 484 L 318 484 L 318 500 L 118 500 L 118 492 L 98 492 Z',
    badge: { x: 160, y: 484 },
    pin: { x: 200, y: 464 }
  },
  B: {
    label: 'Building B — Main Entrance',
    d: 'M 372 486 L 470 486 L 470 506 L 524 506 L 524 542 L 584 542 L 584 604 L 540 604 L 540 644 L 502 644 L 502 686 L 442 686 L 442 646 L 402 646 L 402 604 L 358 604 L 358 542 L 372 542 Z',
    badge: { x: 506, y: 520 },
    pin: { x: 470, y: 482 }
  },
  C: {
    label: 'Building C — Gymnasium',
    d: 'M 646 540 L 792 540 L 792 600 L 762 600 L 762 632 L 646 632 L 646 596 L 664 596 L 664 572 L 646 572 Z',
    badge: { x: 714, y: 566 },
    pin: { x: 714, y: 536 }
  },
  A: {
    label: 'Building A',
    d: 'M 612 640 L 762 640 L 762 662 L 820 662 L 820 742 L 792 742 L 792 802 L 632 802 L 612 762 Z',
    badge: { x: 684, y: 724 },
    pin: { x: 684, y: 636 }
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

/* --- Other named site features -------------------------------------------- */
const RESIDENCE = { x: 822, y: 602, w: 30, h: 158, label: 'Student Residence' };
const CHILD_CARE = { x: 828, y: 822, w: 48, h: 94, label: 'Child Care' };
const UNION_CENTRAL = { d: 'M 370 370 L 466 370 L 466 412 L 370 412 Z', label: 'Union Central', lx: 480, ly: 396 };
const SHUTTLE_STOP = { x: 376, y: 450 };
const BUS_STOP_LABEL = { x: 348, y: 300 };
const ROUNDABOUT = { cx: 396, cy: 706, r: 42 };

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

function lotNode(p) {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const label = p.sub
    ? `<text x="${cx}" y="${cy - 4}" class="cm-lot-label" text-anchor="middle">${p.label}</text>
       <text x="${cx}" y="${cy + 24}" class="cm-lot-label" text-anchor="middle">${p.sub}</text>`
    : `<text x="${cx}" y="${cy + 7}" class="cm-lot-label" text-anchor="middle">${p.label}</text>`;
  return `<g class="cm-lot" data-lot="${p.id}">
      <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="4" class="cm-lot-rect"></rect>
      ${label}
    </g>`;
}

function buildingNode(id, b) {
  return `<g class="cm-building" data-building="${id}" tabindex="0" role="button" aria-label="${b.label}, show on map">
      <path d="${b.d}" class="cm-building-shape"></path>
      <circle cx="${b.badge.x}" cy="${b.badge.y}" r="23" class="cm-badge-disc"></circle>
      <text x="${b.badge.x}" y="${b.badge.y + 9}" class="cm-badge-text" text-anchor="middle">${id}</text>
    </g>`;
}

export function renderCampusMapWidget() {
  const lots = PARKING_LOTS.map(lotNode).join('');
  const buildings = Object.entries(CAMPUS_BUILDINGS).map(([id, b]) => buildingNode(id, b)).join('');
  const modeToggle = `
    <div class="cm-mode-toggle" role="group" aria-label="Map display mode">
      <button class="cm-mode-btn ${campusMode3d ? 'cm-mode-3d-active' : ''}" id="cm-mode-3d" type="button" aria-pressed="${campusMode3d}" title="Interactive 3D map">3D</button>
      <button class="cm-mode-btn ${campusMode3d ? '' : 'cm-mode-2d-active'}" id="cm-mode-2d" type="button" aria-pressed="${!campusMode3d}" title="Flat plan view">Plan</button>
    </div>`;

  const stage3d = `
      <div class="cm-stage cm-stage-3d" id="cm-stage-3d" style="${campusMode3d ? '' : 'display:none;'}">
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
        ${modeToggle}
      </div>`;

  const stageSvg = `
      <div class="cm-stage" id="cm-stage-svg" style="${campusMode3d ? 'display:none;' : ''}">
        <svg viewBox="0 0 ${CAMPUS_VIEWBOX.w} ${CAMPUS_VIEWBOX.h}" class="campus-map-svg" id="campus-map-svg" role="img" aria-label="Davis Campus map">
          <defs>
            <clipPath id="cm-cutout"><circle cx="${CUTOUT.cx}" cy="${CUTOUT.cy}" r="${CUTOUT.r}"/></clipPath>
          </defs>

          <g clip-path="url(#cm-cutout)">
            <rect x="0" y="0" width="${CAMPUS_VIEWBOX.w}" height="${CAMPUS_VIEWBOX.h}" class="cm-site"></rect>

            <!-- Public roads -->
            <rect x="0" y="14" width="${CAMPUS_VIEWBOX.w}" height="48" class="cm-road"></rect>
            <rect x="26" y="14" width="34" height="700" class="cm-road"></rect>
            <text x="452" y="45" class="cm-road-label" text-anchor="middle">Steeles Ave W</text>
            <text x="43" y="360" class="cm-road-label" text-anchor="middle" transform="rotate(-90 43 360)">McLaughlin Road</text>

            <!-- Internal circulation -->
            <path class="cm-drive" d="M 324 62 L 324 520 Q 324 596 372 648 Q 396 676 396 706"></path>
            <path class="cm-drive" d="M 60 764 Q 200 764 300 726 Q 350 708 396 706"></path>
            <path class="cm-drive-thin" d="M 324 178 L 156 178 M 324 336 L 156 336 M 324 514 L 156 514 M 324 640 L 156 640"></path>
            <path class="cm-drive-thin" d="M 460 780 L 460 706 M 604 810 L 604 726 Q 604 706 560 700"></path>
            <circle cx="${ROUNDABOUT.cx}" cy="${ROUNDABOUT.cy}" r="${ROUNDABOUT.r}" class="cm-roundabout"></circle>
            <text x="152" y="736" class="cm-site-label" text-anchor="middle">ENTRANCE</text>

            ${lots}

            <!-- Ancillary structures -->
            <g class="cm-minor">
              <path d="${UNION_CENTRAL.d}" class="cm-building-shape cm-minor-shape"></path>
              <text x="${UNION_CENTRAL.lx}" y="${UNION_CENTRAL.ly}" class="cm-minor-label">${UNION_CENTRAL.label}</text>
            </g>
            <g class="cm-minor">
              <rect x="${RESIDENCE.x}" y="${RESIDENCE.y}" width="${RESIDENCE.w}" height="${RESIDENCE.h}" class="cm-building-shape cm-minor-shape"></rect>
              <text x="${RESIDENCE.x + RESIDENCE.w / 2 + 4}" y="${RESIDENCE.y + RESIDENCE.h / 2}" class="cm-minor-label" text-anchor="middle" transform="rotate(-90 ${RESIDENCE.x + RESIDENCE.w / 2 + 4} ${RESIDENCE.y + RESIDENCE.h / 2})">${RESIDENCE.label}</text>
            </g>
            <g class="cm-minor">
              <rect x="${CHILD_CARE.x}" y="${CHILD_CARE.y}" width="${CHILD_CARE.w}" height="${CHILD_CARE.h}" class="cm-building-shape cm-minor-shape"></rect>
              <text x="${CHILD_CARE.x + CHILD_CARE.w / 2}" y="${CHILD_CARE.y + CHILD_CARE.h + 20}" class="cm-minor-label" text-anchor="middle">${CHILD_CARE.label}</text>
            </g>

            ${buildings}

            <!-- Transit -->
            <text x="${BUS_STOP_LABEL.x}" y="${BUS_STOP_LABEL.y}" class="cm-minor-label" text-anchor="middle" transform="rotate(-90 ${BUS_STOP_LABEL.x} ${BUS_STOP_LABEL.y})">Bus Stop</text>
            <g class="cm-shuttle" data-shuttle="1">
              <path class="cm-shuttle-pin" transform="translate(${SHUTTLE_STOP.x} ${SHUTTLE_STOP.y})" d="M 0 14 C -8 4 -11 -1 -11 -6 A 11 11 0 1 1 11 -6 C 11 -1 8 4 0 14 Z"></path>
              <circle cx="${SHUTTLE_STOP.x}" cy="${SHUTTLE_STOP.y - 6}" r="4" class="cm-shuttle-pin-hole"></circle>
              <text x="${SHUTTLE_STOP.x + 20}" y="${SHUTTLE_STOP.y - 2}" class="cm-minor-label cm-shuttle-label">Shuttle Bus</text>
              <text x="${SHUTTLE_STOP.x + 20}" y="${SHUTTLE_STOP.y + 16}" class="cm-minor-label cm-shuttle-label">Location</text>
            </g>

            <!-- North -->
            <g class="cm-north" transform="translate(824 188)">
              <path d="M 0 -26 L 9 8 L 0 2 L -9 8 Z" class="cm-north-arrow"></path>
              <text x="0" y="28" class="cm-north-text" text-anchor="middle">N</text>
            </g>

            <!-- Location marker -->
            <g class="cm-pin" id="cm-pin" hidden transform="translate(-200,-200)">
              <circle r="30" class="cm-pin-ring cm-pin-ring-a"></circle>
              <circle r="30" class="cm-pin-ring cm-pin-ring-b"></circle>
              <path class="cm-pin-body" d="M 0 4 C -9 -7 -13 -13 -13 -19 A 13 13 0 1 1 13 -19 C 13 -13 9 -7 0 4 Z"></path>
              <circle cx="0" cy="-19" r="4.6" class="cm-pin-hole"></circle>
            </g>
          </g>

          <circle cx="${CUTOUT.cx}" cy="${CUTOUT.cy}" r="${CUTOUT.r}" class="cm-cutout-ring"></circle>
        </svg>
      </div>

      ${stage3d}

    </div>
  `;

  return head + stageSvg;
}

export function highlightBuilding(buildingId) {
  const card = document.getElementById('campus-map-card');
  const target = CAMPUS_BUILDINGS[buildingId];
  if (!card || !target) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /* Active 3D scene takes precedence: camera flies to the building and the
   * wayfinding path animates in; the SVG pin/dim logic is skipped. */
  if (campusMode3d && campus3dManager && campus3dManager.ready) {
    campus3dManager.focus(buildingId);
    const s = document.getElementById('cm-status-text');
    if (s) s.textContent = `Showing ${target.label}.`;
    return;
  }
  if (campusMode3d && !campus3dManager) {
    /* 3D still booting: remember the request and show the plan meanwhile. */
    pendingFocus3d = buildingId;
  }

  const svg = document.getElementById('campus-map-svg');
  if (!svg) return;

  svg.querySelectorAll('.cm-building').forEach((el) => {
    const isTarget = el.dataset.building === buildingId;
    el.classList.toggle('cm-active', isTarget);
    el.classList.toggle('cm-dimmed', !isTarget);
  });
  svg.querySelectorAll('.cm-lot, .cm-shuttle, .cm-minor').forEach((el) => el.classList.add('cm-dimmed'));

  const pin = document.getElementById('cm-pin');
  if (pin) {
    pin.setAttribute('transform', `translate(${target.pin.x}, ${target.pin.y})`);
    pin.removeAttribute('hidden');
  }

  const statusText = document.getElementById('cm-status-text');
  if (statusText) statusText.textContent = `Showing ${target.label}.`;
}

export function clearCampusHighlight() {
  if (campusMode3d && campus3dManager) campus3dManager.reset();
  const svg = document.getElementById('campus-map-svg');
  if (svg) {
    svg.querySelectorAll('.cm-building, .cm-lot, .cm-shuttle, .cm-minor')
      .forEach((el) => el.classList.remove('cm-dimmed', 'cm-active'));
  }
  const pin = document.getElementById('cm-pin');
  if (pin) pin.setAttribute('hidden', '');
  const statusText = document.getElementById('cm-status-text');
  if (statusText) statusText.textContent = 'Davis Campus. Select a building, or use Show location on a class.';
}

/** Boot the 3D manager inside the current widget (if 3D mode is on).
 *  Safe to call on every render: skips when absent/off, tears down any stale
 *  instance whose mount point disappeared, and falls back to the SVG plan
 *  when WebGL/CDN is unavailable. */
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

  /* Wire mode toggle buttons (also functional when 3D failed and we fell back). */
  const btn3d = document.getElementById('cm-mode-3d');
  const btn2d = document.getElementById('cm-mode-2d');
  const setMode = (want3d) => {
    campusMode3d = want3d;
    if (stage) stage.style.display = want3d ? '' : 'none';
    const svgStage = document.getElementById('cm-stage-svg');
    if (svgStage) svgStage.style.display = want3d ? 'none' : '';
    btn3d?.classList.toggle('cm-mode-3d-active', want3d);
    btn2d?.classList.toggle('cm-mode-2d-active', !want3d);
    btn3d?.setAttribute('aria-pressed', String(want3d));
    btn2d?.setAttribute('aria-pressed', String(!want3d));
    if (want3d) {
      initCampusMap3d();
    } else if (campus3dManager) {
      campus3dManager.dispose();
      campus3dManager = null;
    }
  };
  if (btn3d && !btn3d.dataset.cmWired) {
    btn3d.dataset.cmWired = '1';
    btn3d.addEventListener('click', () => setMode(true));
    btn2d?.addEventListener('click', () => setMode(false));
  }

  if (!campusMode3d || campus3dManager) return;

  const loading = document.getElementById('cm3d-loading');
  let manager = null;
  try {
    const { CampusMap3DManager } = await import('./campus-map-3d.js');
    if (!mount.isConnected) return;
    /* Publish the instance before awaiting CDN imports so a second render
     * cannot start a duplicate renderer while the first one is booting. */
    manager = new CampusMap3DManager(mount, {
      getBuildings: () => CAMPUS_BUILDINGS,
      onStatus: (msg) => {
        const s = document.getElementById('cm-status-text');
        if (s) s.textContent = msg;
      }
    });
    campus3dManager = manager;
    const ok = await manager.init();
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
    console.warn('[campus-3d] unavailable, using flat plan:', err && (err.stack || err.message));
    campus3dManager = null;
    manager?.dispose();
    campusMode3d = false;
    setMode(false);
    const s = document.getElementById('cm-status-text');
    if (s) s.textContent = '3D view unavailable here — showing flat plan.';
  }
}

/* Building requested via Show location before the 3D scene finished booting. */
let pendingFocus3d = null;

export function disposeCampusMap3d() {
  if (campus3dManager) {
    campus3dManager.dispose();
    campus3dManager = null;
  }
}

export function attachCampusMapHandlers() {
  const svg = document.getElementById('campus-map-svg');
  if (svg) {
    svg.querySelectorAll('.cm-building').forEach((el) => {
      el.addEventListener('click', () => highlightBuilding(el.dataset.building));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); highlightBuilding(el.dataset.building); }
      });
    });
  }
  if (svg) {
    svg.addEventListener('click', (event) => {
      if (!event.target.closest('.cm-building')) clearCampusHighlight();
    });
  }
}
