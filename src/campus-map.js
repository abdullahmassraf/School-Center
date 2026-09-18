/* =========================================================================
   CAMPUS MAP WIDGET
   Interactive SVG campus map. Renders building nodes, parking lots, and the
   shuttle stop, and exposes highlightBuilding(buildingId) so any "Show
   location" button elsewhere in the app (an upcoming class card, a course
   schedule row, etc.) can scroll to this widget and highlight the right
   building with a glowing pin while dimming everything else.
   ========================================================================= */

// Schematic layout (not a literal campus photo — a stylized diagram) in a
// 720x480 viewBox. Coordinates were chosen to read clearly as a campus:
// a central quad with buildings around it, parking lots at the perimeter,
// and a shuttle stop near the main path intersection.
export const CAMPUS_BUILDINGS = {
  A: { label: 'Building A', x: 40,  y: 260, w: 130, h: 100 },
  B: { label: 'Building B', x: 210, y: 130, w: 120, h: 90 },
  C: { label: 'Building C', x: 330, y: 40,  w: 190, h: 120 },
  H: { label: 'Building H', x: 550, y: 150, w: 120, h: 100 },
  J: { label: 'Building J', x: 500, y: 300, w: 140, h: 100 },
  M: { label: 'Building M', x: 260, y: 300, w: 130, h: 100 }
};

const PARKING_LOTS = [
  { id: 'lot-1', label: 'Lot 1', x: 10,  y: 10,  w: 100, h: 60 },
  { id: 'lot-2', label: 'Lot 2', x: 10,  y: 410, w: 100, h: 60 },
  { id: 'lot-3', label: 'Lot 3', x: 640, y: 10,  w: 90,  h: 60 },
  { id: 'lot-4', label: 'Lot 4', x: 640, y: 410, w: 90,  h: 60 },
  { id: 'lot-5', label: 'Lot 5', x: 190, y: 440, w: 90,  h: 34 },
  { id: 'lot-6', label: 'Lot 6', x: 420, y: 440, w: 90,  h: 34 }
];

const SHUTTLE_STOP = { x: 380, y: 205 };

/** First letter of a room string ("C328" -> "C"). Returns null for
 * non-physical rooms ("Online (VTL)") or anything not in CAMPUS_BUILDINGS. */
export function getBuildingIdForRoom(room) {
  if (!room) return null;
  const m = String(room).trim().match(/^([A-Za-z])/);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return CAMPUS_BUILDINGS[code] ? code : null;
}

/** A small "Show location" button other views can drop in next to a class
 * or assignment that has a real physical room. Returns '' if the room
 * doesn't map to a known building (e.g. "Online (VTL)"), so callers can
 * splice this straight into a template without an extra conditional. */
export function renderShowLocationButton(room, extraStyle = '') {
  const buildingId = getBuildingIdForRoom(room);
  if (!buildingId) return '';
  return `<button class="cm-show-location-btn" data-show-location="${buildingId}" type="button" style="${extraStyle}">📍 Show location</button>`;
}

export function renderCampusMapWidget() {
  const lotNodes = PARKING_LOTS.map(p => `
    <g class="cm-lot" data-lot="${p.id}">
      <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" class="cm-lot-rect"></rect>
      <text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" class="cm-lot-label" text-anchor="middle">${p.label}</text>
    </g>
  `).join('');

  const buildingNodes = Object.entries(CAMPUS_BUILDINGS).map(([id, b]) => `
    <g class="cm-building" data-building="${id}" tabindex="0" role="button" aria-label="${b.label}, show on map">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="16" class="cm-building-rect"></rect>
      <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 6}" class="cm-building-label" text-anchor="middle">${id}</text>
    </g>
  `).join('');

  return `
    <div class="panel campus-map-card" id="campus-map-card">
      <div class="cm-head">
        <div>
          <h3 class="headfont" style="margin:0;">Campus Map</h3>
          <div class="section-sub" id="cm-status-text">Tap a building, or use "Show location" on a class.</div>
        </div>
        <button class="btn-ghost cm-reset-btn" id="cm-reset-btn" type="button" style="display:none;">Show all</button>
      </div>
      <div class="cm-svg-wrap">
        <svg viewBox="0 0 730 490" class="campus-map-svg" id="campus-map-svg" role="img" aria-label="Interactive campus map">
          <rect x="0" y="0" width="730" height="490" class="cm-ground" rx="20"></rect>
          <path d="M 365 0 L 365 490 M 0 245 L 730 245" class="cm-path"></path>
          ${lotNodes}
          ${buildingNodes}
          <g class="cm-shuttle" data-shuttle="1" tabindex="0" role="img" aria-label="Shuttle bus stop">
            <circle cx="${SHUTTLE_STOP.x}" cy="${SHUTTLE_STOP.y}" r="15" class="cm-shuttle-dot"></circle>
            <text x="${SHUTTLE_STOP.x}" y="${SHUTTLE_STOP.y + 5}" class="cm-shuttle-icon" text-anchor="middle">🚌</text>
            <text x="${SHUTTLE_STOP.x}" y="${SHUTTLE_STOP.y + 32}" class="cm-shuttle-label" text-anchor="middle">Shuttle</text>
          </g>
          <g class="cm-pin" id="cm-pin" style="display:none;" transform="translate(0,0)">
            <circle r="5" class="cm-pin-dot"></circle>
            <circle r="14" class="cm-pin-ring cm-pin-ring-a"></circle>
            <circle r="14" class="cm-pin-ring cm-pin-ring-b"></circle>
          </g>
        </svg>
      </div>
      <div class="cm-legend">
        <span><i class="cm-dot cm-dot-building"></i>Building</span>
        <span><i class="cm-dot cm-dot-lot"></i>Parking</span>
        <span><i class="cm-dot cm-dot-shuttle"></i>Shuttle</span>
      </div>
    </div>
  `;
}

export function highlightBuilding(buildingId) {
  const card = document.getElementById('campus-map-card');
  const svg = document.getElementById('campus-map-svg');
  const target = CAMPUS_BUILDINGS[buildingId];
  if (!card || !svg || !target) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });

  svg.querySelectorAll('.cm-building').forEach((el) => {
    if (el.dataset.building === buildingId) {
      el.classList.add('cm-active');
      el.classList.remove('cm-dimmed');
    } else {
      el.classList.remove('cm-active');
      el.classList.add('cm-dimmed');
    }
  });
  svg.querySelectorAll('.cm-lot, .cm-shuttle').forEach((el) => el.classList.add('cm-dimmed'));

  const pin = document.getElementById('cm-pin');
  if (pin) {
    pin.setAttribute('transform', `translate(${target.x + target.w / 2}, ${target.y - 6})`);
    pin.style.display = '';
  }

  const resetBtn = document.getElementById('cm-reset-btn');
  if (resetBtn) resetBtn.style.display = '';

  const statusText = document.getElementById('cm-status-text');
  if (statusText) statusText.textContent = `Showing ${target.label}`;
}

export function clearCampusHighlight() {
  const svg = document.getElementById('campus-map-svg');
  if (svg) {
    svg.querySelectorAll('.cm-building, .cm-lot, .cm-shuttle').forEach((el) => el.classList.remove('cm-dimmed', 'cm-active'));
  }
  const pin = document.getElementById('cm-pin');
  if (pin) pin.style.display = 'none';
  const resetBtn = document.getElementById('cm-reset-btn');
  if (resetBtn) resetBtn.style.display = 'none';
  const statusText = document.getElementById('cm-status-text');
  if (statusText) statusText.textContent = 'Tap a building, or use "Show location" on a class.';
}

/** Wires up clicks inside the map (building nodes + reset button) and any
 * [data-show-location] buttons elsewhere on the current page. Safe to call
 * on every render — it's a no-op where the relevant elements don't exist. */
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
  const resetBtn = document.getElementById('cm-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', clearCampusHighlight);
  // Note: [data-show-location] buttons are wired in app.js's global
  // attachEventHandlers(), not here — they need to be able to switch to
  // the Today view first (where this widget lives) before highlighting,
  // which this module has no view-router access to do.
}
