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
