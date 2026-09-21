# Davis Campus 3D Twin Migration

## Goal
Keep the existing School Center campus-map card, buttons, chips, status line, loading state, fallback, sizing and CSS. Replace only the 3D environment with the supplied Davis Campus digital twin.

The pre-migration renderer was preserved as `src/campus-map-3d.legacy.js`. The production `src/campus-map-3d.js` is now a host adapter; the twin is mounted as `/campus-twin.html?embed=1`.

## Audit: old public contract used by the app

`src/app.js` reaches the 3D module indirectly through `src/campus-map.js`. The integration imports/constructs `CampusMap3DManager` and uses:

- constructor `new CampusMap3DManager(mount, opts)`
- `manager.mount` — stale-mount detection when the app re-renders
- `manager.init()` — asynchronous boot
- `manager.ready` — gates building focus until boot is complete
- `manager.focus(id)` — building chips and Show location
- `manager.reset()` — clear highlight / overview
- `manager.resize()` — post-layout renderer resize
- `manager.refreshAccent()` — live `--accent` propagation
- `manager.dispose()` — lifecycle cleanup
- `manager.weatherCondition` — legacy manager-style weather state

The options supplied by `src/campus-map.js` are preserved: `accentColor`, `getBuildings`, `getInfrastructure`, and `onStatus`.

The old module also exported `solarPosition`; the app did not import/use it. The untouched legacy implementation remains available in `src/campus-map-3d.legacy.js` for rollback/reference.

## App DOM hooks audited

The existing app owns and continues to own:

- `#campus-map-card`
- `#cm-stage-3d`
- `#cm3d-mount`
- `#cm3d-loading`
- `#cm-status-text`
- `[data-map-chip]`
- `[data-show-location]`

The adapter only replaces the contents of `#cm3d-mount` with an iframe. `src/campus-map.js` still removes `#cm3d-loading` after successful initialization and uses its existing no-WebGL fallback on failure.

## Legacy scene hooks/tests

The previous renderer exposed and/or tested scene internals such as `meshById`, `buildingMeshes`, `scene`, `camera`, `renderer`, `pathGroup`, `pathLines`, `routeArrows`, `focusRing`, `weatherCondition`, `_ingestWeather`, `_applyTimeOfDay`, `_nightWindows`, `wetness`, `lotMat`, `grid`, `softwareGpu`, and renderer statistics. Those are no longer production API requirements: the iframe owns them. Local headless runs add `?debug` and expose `window.__DAVIS_TWIN_DEBUG__` inside the same-origin iframe so the tests can inspect scene state without coupling the deployed app to Three.js internals.

## Building IDs

Verified against both app data and twin data:

`J, H, M, B, C, A`

They are a 1:1 identity match. No alias table is required; source-array order differs but IDs are stable.

## Behavior mapping

| Old behavior | Twin adapter/protocol |
|---|---|
| Building selection | `campus:select {id|null}` |
| Show location / focus | `campus:select {id}` |
| Bus-stop route | Twin `select()` calls its existing `showRoute()` |
| Reset / overview | `campus:reset` |
| Idle auto-orbit | `campus:autoorbit {value}` |
| Accent | `campus:accent {value}` |
| Light/dark theme | `campus:theme {value}` |
| Weather | `campus:weather {value}` |
| Season | `campus:season {value}` |
| Time / solar override | `campus:time {value}` |
| Route visibility | `campus:routeVisible {value}` |
| Resize | `campus:resize` |
| Hidden tab / iframe | `campus:visibility {value}` + twin `visibilitychange` |
| Ready/loading | twin posts validated `ready`; adapter resolves `init()` |
| Selection callback | twin posts validated `select` |
| Weather chip | twin posts condition/temperature; adapter updates the legacy chip |

## postMessage validation

Host accepts messages only when:

- `event.source === iframe.contentWindow`
- `event.origin === location.origin`
- `event.data.source === 'davis-twin'`
- `event.data.type` is a recognized string

Twin accepts host messages only when:

- `event.source === parent`
- `event.origin === location.origin`
- message data is an object with a recognized type

Messages use the concrete same-origin target rather than `*`.

## UI rule

The twin's own title, panel, dock, info card, compass, hint and debug HUD are hidden by `body.embed`. School Center's existing UI remains outside the iframe. The adapter retains the old map reset/path controls and weather chip so existing map affordances are not silently dropped.

## Lifecycle/performance

The twin retains its existing quality tiers, adaptive pixel ratio, weather effects, sky/lighting, post-processing and camera interaction. The adapter adds no render loop. The twin pauses its RAF when hidden and responds to explicit host visibility messages. On `pagehide`, it disposes the renderer/environment resources; removing the iframe releases its browsing context/WebGL context.

Reduced-motion users get idle auto-orbit disabled.

## Verification

Implemented in this branch:

- [x] J/H/M/B/C/A ID parity
- [x] Existing School Center map UI untouched
- [x] Embed mode is canvas-only
- [x] Selection, route, reset, accent, weather, season, time, resize, visibility and auto-orbit protocol
- [x] Same-origin/source validation on both sides
- [x] Legacy renderer preserved for rollback
- [x] Headless tests moved to the iframe/protocol architecture
- [x] Light-quality probe moved to the debug twin architecture

Real-device items still require Chrome desktop, Chrome Android and Safari iOS access:

- [ ] 60 fps desktop / 30+ fps mid-range mobile measurements
- [ ] draw-call measurements from `?debug`
- [ ] screenshots for overview, J/H/M/B/C/A, night and rain
- [ ] 20 open/close lifecycle cycle check
- [ ] live GitHub Pages smoke test after merge

## Rollback

The immediate rollback target is the merge commit for this migration. The previous renderer is preserved verbatim as `src/campus-map-3d.legacy.js`. To restore the previous scene, restore that file to `src/campus-map-3d.js` and remove the twin/adapter changes. No `index.html` Supabase metadata was changed.


## Fullscreen / Drive Easter Egg / Cinematic Idle Upgrade

### Fullscreen
The fullscreen control is added to the existing host-side `.cm3d-hud`, so it receives the same glass/border/spacing/hover treatment as the reset and route controls. It calls `document.documentElement.requestFullscreen()` and `document.exitFullscreen()` in the host document, and its icon/ARIA label are synchronized from the real `document.fullscreenElement` state. A `fullscreenchange` handler runs the existing resize path and repeats it inside `requestAnimationFrame()` to avoid stretched intermediate frames.

### Hidden Drive activation
No mobile or touchscreen Drive UI was added. A physical `keydown` with `code === 'KeyD'` activates the existing twin Drive system only when the actual parent document has a fullscreen element. `repeat` and editable targets are ignored. Once Drive is active, `D` remains the existing steering-right input. Escape disables Drive, while any fullscreen exit also disables Drive through both the parent event and validated host protocol.

### Cinematic idle camera
The twin no longer uses `OrbitControls.autoRotate` for idle presentation. A custom low-frequency cinematic layer tracks real interaction time and smoothly ramps after 1.5s of inactivity, with a 0.45s response envelope. It applies small yaw velocity variation, bounded target drift, subtle elevation modulation and ±0.8% camera breathing. For a selected building the pivot is the building's visual center plus 35% of its primary mass height. Drive, tours, active fly-to transitions, reduced-motion mode, and hidden rendering suppress cinematic motion. User interaction marks are emitted only for actual pointer/keyboard/HUD input rather than stationary hover.

### Acceptance status
The requested source-level integration is complete. Browser/device measurements and screenshots still require a real browser/device execution environment; no FPS/draw-call numbers are fabricated.


## Map-only fullscreen + compact controls + smart Drive camera

### Fullscreen root
The fullscreen root is the existing `#cm-stage-3d` element generated by `renderCampusMapWidget()`. The host adapter stores it as `fullscreenRoot` and calls `fullscreenRoot.requestFullscreen()`; it never requests fullscreen on `document.documentElement`.

The fullscreen state is considered active only when `document.fullscreenElement === fullscreenRoot`. `fullscreenchange` synchronizes the host button, sends `campus:fullscreen-state` to the twin, locks page body overflow, and schedules the twin's normal resize on the next animation frame. The stage's normal card width/height/radius constraints are removed in `:fullscreen`, so only the map stage occupies the display. The surrounding School Center header, building chips and dashboard cards remain outside the fullscreen element and therefore are not presented in map fullscreen.

### Compact HUD
The host reset/path/fullscreen controls share the existing `.cm3d-hud button` glass styling but are now 32×32px with a 9px radius and compact spacing, matching the visual scale of the weather pill. Weather and HUD positions include safe-area insets.

### Drive camera
The existing Rapier vehicle/Drive system remains the source of physics and steering. A new `driveCamera` state adds a restrained chase blend:
- moving threshold: 0.65 m/s forward speed
- release pause before recentering: 180 ms
- follow damping: 2.5
- target damping: 4.0
- user zoom distance is preserved and clamped to 6–26 m
- high speed may add up to 1.5 m of follow distance
- desired camera sits behind and above the vehicle and looks 4.5 m ahead
- manual left-button/touch orbit disables chase while active
- wheel/pinch zoom does not disable chase
- a stationary car does not auto-recenter
- no per-frame `new THREE.Vector3()` is introduced by the chase system

The existing Drive activation remains fullscreen-gated to the map stage specifically, and Drive automatically exits on any map-fullscreen exit.

### Verification
Added regression assertions for map-stage fullscreen geometry/overflow, compact fullscreen control presence, fullscreen-gated Drive, smart chase activation while moving, cinematic idle overview/selected-building behavior, and console errors. Actual Chrome Android/Safari iOS hardware measurements still require those real device environments.
