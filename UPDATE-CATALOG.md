# School Center — Update Catalog

## Purpose

This document is the permanent change log for the School Center project. It records the major features, fixes, architecture changes, and deployment/setup changes included in the current build.

**Future changes:** Every future change made to School Center should be documented in this catalog. When the app is updated, this file should be updated in the same commit/package with the date, files changed, feature/fix description, and any Supabase or deployment steps required.

---

## Current Release: Automatic Bidirectional Sync Update

### 1. Automatic Notes & Assignments Cloud Sync
- Notes and assignments can sync through Supabase without pressing Push/Pull buttons for normal use.
- Local changes are watched automatically.
- Changes are debounced briefly to avoid excessive requests while typing/editing.
- A background reconciliation runs periodically.
- Sync is retried when the browser returns online or regains focus.
- A signed-in user is used as the cloud identity so data stays scoped to that account.

### 2. Bidirectional Realtime Updates
- Device A can create or edit a note and Device B can receive it automatically.
- Device B can create or edit a note and Device A can receive it automatically.
- The same pattern applies to assignments.
- Supabase Realtime channels listen for changes to the user's rows.
- Newer `updatedAt` values are used when merging cloud and local records.

### 3. Reliable Deletions
- Deletions are remembered as tombstones rather than being treated as a local-only disappearance.
- Cloud rows use `deleted_at` so a deleted item can be synchronized as a deletion event.
- This prevents an old copy on another device from being treated as a new item and resurrecting it.
- The migration is idempotent for the new `deleted_at` columns, so it is safe to run after the earlier version of migration 002.

### 4. Notes Improvements
- Notes have cloud merge support.
- Notes notify the sync engine when created, updated, or deleted.
- Existing local note data remains usable when cloud access is unavailable.

### 5. Assignments Improvements
- Assignments have cloud merge support.
- Assignments notify the sync engine when created, updated, or deleted.
- Existing local assignment data remains usable when cloud access is unavailable.

### 6. AI / Search Workspace
- AI and Search are combined into a unified workspace.
- Search operates across the app and can transition into AI assistance when appropriate.
- AI history can be synchronized through Supabase.
- AI messages support editing, deletion, and clearing the conversation.
- Current date/time context can be supplied to the AI workspace.
- File/media handling is integrated into the AI workspace.

### 7. Voice / Audio Features
- Voice memo functionality uses browser audio capabilities.
- Audio visualization/playback functionality is included in the project.
- AI transcription workspace support is included for compatible browser/API configuration.

### 8. Course Hub / Academic Organization
- Course data, assignments, materials, notes, calendar, focus, practice, and search modules remain integrated.
- ENGR 43301D Engineering Economics and Entrepreneurship routing includes the combined Background Assignment & Biography item in Assignments rather than Materials.

### 9. Visual/UI Changes
- iOS-inspired glassmorphism styling.
- Glass surfaces use blur, translucency, saturation, edge highlights, and soft shadows.
- Responsive desktop/mobile layout.
- Bottom navigation uses icons rather than text labels.
- AI/Search is positioned as a primary application section.
- Settings contains application/account configuration and sync-related controls.
- The interface is designed to preserve the same visual language across the app.

### 10. Sync/Settings Controls
- Manual Push/Pull controls may remain available as recovery/debug controls, but they are no longer intended as part of normal daily use.
- Automatic synchronization starts when a valid cloud identity is available and stops when the user signs out.

### 11. Supabase Database
- `user_notes` stores each user's note records.
- `user_assignments` stores each user's assignment records.
- Row Level Security scopes records to the authenticated user.
- Supabase Realtime is enabled for the sync tables.
- `deleted_at` is used for persistent deletion synchronization.

### 12. Security / Configuration
- Browser-facing Supabase configuration uses the publishable client key.
- Sensitive Gemini credentials belong in Supabase Edge Function secrets rather than public frontend files.
- Authentication redirect configuration uses the deployed GitHub Pages URL.
- Private secrets should never be committed to GitHub.

---

## Files Added or Updated in This Release

### Core application
- `src/app.js`
- `src/data-sync.js`
- `src/notes.js`
- `src/assignments.js`
- `src/ai-history.js`
- `src/ai-workspace.js`
- `src/style.css`
- `src/supabase.js`
- Related existing course, upload, search, audio, focus, and practice modules are retained.

### Supabase
- `supabase/migrations/002_user_notes_assignments.sql`
- Existing AI schema/configuration files are retained.

### Documentation
- `UPDATE-CATALOG.md` — this permanent update catalog.
- Existing README/setup/change-log files are retained.

---

## Deployment Notes

1. Upload the updated project files to the GitHub repository.
2. In Supabase SQL Editor, run the contents of `supabase/migrations/002_user_notes_assignments.sql`.
3. Keep the Supabase authentication Site URL and Redirect URL configured for the deployed GitHub Pages site.
4. Keep sensitive Gemini credentials in Supabase Edge Function secrets, not in GitHub.
5. After deployment, hard-refresh the app and test synchronization on at least two signed-in devices.

---

## Future Documentation Rule

**Any future change to School Center must be documented here.**

For every future release/update, add:
- Date/version
- What changed
- Why it changed
- Files changed/added/removed
- Database changes, if any
- New settings/secrets, if any
- User-facing behavior changes
- Known limitations or follow-up work
- Deployment/migration instructions

This catalog is intended to remain with the project permanently so the history of School Center's development is preserved in the repository and in future project ZIPs.

---

## Release v1.1.0 — 2026-09-17

### Date
2026-09-17

### Version
v1.1.0 (up from v1.0.0)

### Change
Fixed the root cause of "notes only save on the device I write them on": the app's sync engine was already correct, but it silently requires the user to be signed in (Settings → email magic link) before any Notes/Assignments sync happens, and nothing in the UI made that clear or even accurate:
- The Settings "Cloud Sync" status badge said **"Connected"** whenever a Supabase project URL/key were present — even if the user had never signed in. It never actually checked sign-in state, so it looked like sync was working when it had never started.
- The sign-in card was labeled **"AI history account"** and only mentioned AI chat history — nothing told the user that the same sign-in is also what makes Notes and Assignments sync.
- The colored status dot (`.ai-connection-dot`) had no CSS for its `ready` / `busy` / `attention` / `idle` states, so it always rendered the same green regardless of what was actually happening.
- Background sync failures (e.g. a migration not yet run in Supabase, so the `user_notes`/`user_assignments` tables don't exist) were caught and silently discarded (`catch (_) {}`), so a real, ongoing sync failure produced zero feedback.

### Reason
The sync code itself (debounced local-change watcher, Realtime subscriptions, tombstone-based deletion sync) was functioning as designed. The actual failure was invisibility: a user who never explicitly signs in with the same email on every device will never sync, and this build gave no indication that sign-in was required or that it hadn't happened.

### User-facing behavior
- Settings → Cloud Sync now shows one of: "Local only — cloud not configured", "Not signed in — notes stay on this device only", "Sync error — see below", "N processing", or "Connected as you@email.com" — reflecting the real state, not just whether Supabase credentials exist.
- The status dot now actually changes color: green (synced), amber/pulsing (in progress or not signed in), red (error), dim (not configured).
- If a background sync attempt fails, the real error message is shown under Cloud Sync instead of failing silently.
- The account card is renamed "Account & cross-device sync" and explicitly explains that signing in with the same email on every device is what makes Notes, Assignments, and AI history follow you between devices — and that nothing syncs until you've done this on at least two devices.
- A dismissible amber banner now appears at the top of the Today view whenever you have local notes/assignments but are not signed in, warning that they're only saved on this device.
- "Sync now" in Settings now shows the actual error message on failure instead of a generic "Sync unavailable" message.

### Files changed
- `src/app.js` — sync status logic, Settings copy, new sync banner + its render/attach code, error-state wiring, manual sync button error handling, new `dataSyncLastError` / `dataSyncLastOkAt` / `syncBannerDismissed` state fields.
- `src/data-sync.js` — background sync failures now dispatch a `schoolcenter:data-sync-changed` event with the error message instead of being swallowed; success also now dispatches an "ok" event to clear any prior error state.
- `src/style.css` — added missing `.ai-connection-dot` state-color variants, `.sync-warning-inline`, `.sync-banner` and related styles (glassmorphism-consistent).
- `UPDATE-CATALOG.md` — this entry.

### Database changes
None. This release does not add or modify any Supabase tables, columns, or policies. It assumes `supabase/migrations/002_user_notes_assignments.sql` (already in the project) has been run — if it hasn't, the new error banner will now surface that clearly instead of failing silently.

### Configuration changes
None required. No new environment variables, keys, or Edge Functions.

### Deployment instructions
See "HOW TO UPDATE GITHUB" and "HOW TO UPDATE SUPABASE" below.

### Testing
- Validated JavaScript syntax with `node --check` on `src/app.js` and `src/data-sync.js` — both pass.
- Manually traced the sync/auth code path (`getCurrentAiUser`, `onAuthStateChange`, `startAutomaticDataSync`, `fullTwoWaySync`) to confirm the new status logic matches real state.
- Could not perform a live two-device browser test in this environment (no network access here) — you should verify by signing in with the same email in Settings on two devices/browsers and confirming a note created on one appears on the other within ~30 seconds, per the Test checklist below.

### Known limitations
- This release fixes visibility and error-reporting; it does not change the underlying sync mechanism. If the Supabase migration `002_user_notes_assignments.sql` was never run, sync will still fail — but now the app will tell you why instead of staying silent.
- Mobile nav bar redesign, search UI polish, "stay on last page after refresh", and banner portfolio-link/redesign requests are **not** included in this release — they were deferred by request so this sync fix could be done thoroughly first.

---

## Release v1.2.0 — 2026-09-17

### Date
2026-09-17

### Version
v1.2.0 (up from v1.1.0)

### Change
Two independent fixes/features in this release:

**A. Mobile bottom navigation bar — consolidated and fixed.**
The nav bar had accumulated roughly six separate, conflicting CSS definitions of `.bottom-nav` / `.bottom-nav-wrap` / `.nav-item` across the stylesheet (several using `!important` against each other), from what looks like several past "make it glassy" passes stacked without cleanup. Concretely, this caused:
- An opaque strip painted across the *entire* width of the fixed bottom container (`.bottom-nav-wrap`), not just the floating pill — because a later rule accidentally included `.bottom-nav-wrap` in a shared selector list meant for the pill only.
- The pill's `border-radius: 999px` fighting with later `18px`/`16px`/`14px` `!important` overrides at different breakpoints, so the shape could shift depending on which rule won the cascade.
- Nav item size flip-flopping between `54px` → `48px` → `44px` across three different, uncoordinated media queries.
- A leftover rule from an earlier design (when nav items had visible text labels) still setting `font-size`/padding on `.nav-item` even though no label text is rendered anymore.

All of this is now a single canonical block (search `CANONICAL BOTTOM NAV` in `src/style.css`) with one clean mobile breakpoint. No other rule in the file targets these three selectors anymore.

**B. Interactive Campus Map widget (new feature).**
A new glassmorphism-styled Campus Map card on the Today view:
- Inline SVG showing Buildings A, B, C, H, J, M, Parking Lots 1–6, and the Shuttle stop, styled with the app's dark translucent glass tokens (`rgba(18, 18, 24, 0.65)` background, `blur(20px) saturate(180%)`, `1px solid rgba(255,255,255,0.08)` border).
- "Show location" buttons now appear next to: the next-class summary at the top of Today, each scheduled class in the Calendar day agenda, and each schedule row on a course's detail page — wherever a room like `C328` or `J301` appears. The building is derived automatically from the room's leading letter; rooms with no physical building (e.g. "Online (VTL)") get no button.
- Clicking a building (or a "Show location" button) smooth-scrolls to the map, adds a pulsing glow + pin marker on that building, and dims every other building/lot/shuttle node for contrast. A "Show all" button clears the highlight. Clicking from a view other than Today (e.g. Calendar) switches to Today first, then highlights.

### Reason
(A) was reported as "the navigation bar UI style sucks for mobile" — root cause was CSS rule conflicts, not a single missing style. (B) was a new feature request: link upcoming classes/rooms to a visual campus map.

### User-facing behavior
- The bottom nav is now a single, consistent floating glass pill on every screen size, with no background bleeding across the full width behind it.
- A new "Campus Map" card appears near the bottom of the Today tab.
- "📍 Show location" buttons appear next to any class/session that has a real room.

### Files changed
- `src/style.css` — nav bar consolidation (removed ~5 duplicate/conflicting rule blocks, added one canonical block); added Campus Map widget styles.
- `src/app.js` — imports and renders the campus map widget on Today; adds "Show location" buttons to the next-class summary, Calendar agenda items, and course schedule rows; adds a view-aware click handler for `[data-show-location]` buttons.
- `src/campus-map.js` — **new file**. Exports `renderCampusMapWidget()`, `renderShowLocationButton(room)`, `getBuildingIdForRoom(room)`, `highlightBuilding(buildingId)`, `clearCampusHighlight()`, `attachCampusMapHandlers()`.

### Database changes
None.

### Configuration changes
None.

### Deployment instructions
See "HOW TO UPDATE GITHUB" below. No Supabase changes.

### Testing
- `node --check` passed on every file in `src/`.
- Verified every local `./*.js` import in `src/` resolves to a real file.
- Verified CSS brace balance (690 open / 690 close) after the nav consolidation.
- Manually traced the highlight/scroll logic and the room→building resolver against the actual room codes already in the app's schedule data (`C328`, `J301`, `C271`, `A305`, `Online (VTL)`).
- Could not perform a live browser/visual test in this environment (no network/browser access here) — please verify the nav bar and map visually on an actual phone per the checklist below.

### Known limitations
- The campus map is a **stylized schematic diagram**, not a to-scale rendering of a real reference photo — none was attached to this request. If you have an actual campus map image, share it and the building positions can be adjusted to match it precisely.
- Search UI polish, refresh-persists-last-page, AI chat history cross-device sync, live theme sync, and the banner redesign/portfolio link are still queued for a future release.

---

## Release v1.3.0 — 2026-09-17

### Date
2026-09-17

### Version
v1.3.0 (up from v1.2.0)

### Summary
Six changes: two regression fixes with identified root causes (cloud sync,
Gemini AI), and four design corrections (mobile navigation, top banner, app
background, campus map).

---

### A. Cloud sync stopped working across devices — FIXED

**Root cause (three compounding faults, all in the transport layer, none in
the merge/tombstone logic added in the earlier sync release):**

1. **Duplicate realtime channel race.** `startAutomaticDataSync()` was called
   from three places during boot: the `app.js` bootstrap (unconditional), the
   `onAuthStateChange` callback, and the `loadAiChatHistory().then()`
   callback. All three ran concurrently. Each awaited `getCurrentAiUser()`,
   then each called `attachRealtime()`, which subscribed a channel named
   `school-center-notes-<uid>` / `school-center-assignments-<uid>`.
   Subscribing a second channel on a topic that already has a live
   subscription is rejected by supabase-js. The result was leaked channels
   plus, frequently, a surviving channel stuck in `CHANNEL_ERROR` — realtime
   was dead while Settings reported "Connected".
2. **Subscribe status was never checked.** `.subscribe()` was called with no
   callback, so `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` produced no feedback
   and triggered no recovery.
3. **Identity lookup made a network call per operation.**
   `getCurrentAiUser()` used `sb.auth.getUser()`, which requests
   `/auth/v1/user` every time. `requireCloudIdentity()` is called once per
   table read and once per table write, so one reconciliation pass made four
   or more extra round-trips. Any one of them failing (flaky wifi, a phone
   waking from sleep) returned `null`, which the sync engine reports as "not
   signed in".

**Fixes:**
- `startAutomaticDataSync()` is now **single-flight** (`startInFlight`
  promise). Concurrent callers share one in-flight start instead of tearing
  down each other's channels.
- The unconditional bootstrap call in `app.js` was removed. Sync now starts
  only from the auth-state path.
- `teardownChannels()` removes this module's channels *and* sweeps
  `sb.getChannels()` for any orphan on a `school-center-*` topic before every
  subscribe, so a leaked channel from a previous session cannot block a fresh
  one.
- `.subscribe(onChannelStatus)` tracks status. On `CHANNEL_ERROR`/`TIMED_OUT`/
  `CLOSED` the engine marks realtime `degraded`, tells the UI, and switches to
  a **15-second reconciliation poll** — so notes and assignments still cross
  devices with the websocket blocked (corporate wifi, captive portals, and
  blocked `wss://` are all common causes).
- The periodic loop was a `setInterval`, which is why it could never change
  its own cadence. It is now a self-rescheduling `setTimeout` with an adaptive
  interval: 30s when realtime is healthy, 15s when degraded, exponential
  backoff to a 5-minute ceiling while requests keep failing.
- `document.addEventListener('visibilitychange', ...)` added as a wake
  trigger. `focus` alone often does not fire on mobile Safari/Chrome when
  returning to a backgrounded tab, which is why phones felt like they never
  picked up desktop changes.
- `getCurrentAiUser()` now reads `sb.auth.getSession()` (local, with
  supabase-js refreshing on its own schedule) and only falls back to
  `getUser()` for the first call after a magic-link redirect.
- New export `getDataSyncStatus()` returns `{ running, realtime,
  consecutiveFailures, lastSyncOkAt }`.
- Settings now distinguishes "Connected" from "Syncing periodically" and shows
  live-update state, last successful sync time, and consecutive failure count.
  A dead websocket can no longer render as a healthy connection.

---

### B. AI stopped working while "Test connection" passed — FIXED

**Root cause (three faults, same symptom):**

1. **A single hard-coded model.** `gemini-3.6-flash` was the only model the
   app would ever call. Google retires Gemini model IDs on a rolling schedule
   (2.0 Flash shut down 2026-06-01; 2.5 Pro in October 2026). A retired ID
   returns HTTP 404 — the app breaks one day with no code change on our side.
   This is exactly the "worked yesterday, broken today" shape.
2. **The tools payload was non-negotiable.** Every request shipped
   `tools: [{ function_declarations: ... }]`. A model rejecting the tool
   schema killed the whole conversation instead of degrading to plain chat.
3. **Malformed conversation history.** The user's new turn was pushed into
   `state.aiChatMessages` *before* `queryGemini()` read it, so the same
   message was sent twice — once inside the replayed history, once as the live
   turn — producing two consecutive `user` roles.

"Test connection" shared this code path with a trivial prompt that never
exercised tool calling or history replay, which is why it could report
"verified" while real chat failed.

**Fixes:**
- `GEMINI_MODEL_CHAIN` = `gemini-3.8-flash` → `gemini-3.7-flash` →
  `gemini-3.6-flash` → `gemini-2.5-flash`. The first model that answers is
  cached in `localStorage` under `sc_gemini_model` so later calls go straight
  to it.
- Error triage: a 404 (or a 400 containing "not found"/"not supported") means
  the model ID is gone — move to the next. 401/403 (bad key), 429 (quota),
  5xx (outage) and network failures are surfaced immediately rather than
  burning the whole chain and reporting the last error.
- Tool-schema rejections retry the same model once without `tools`.
- `sanitizeHistory()` drops trailing user turns, ensures history opens on a
  user turn, and collapses consecutive same-role turns.
- Empty responses now report `promptFeedback.blockReason` / `finishReason`
  instead of a bare "empty response".
- "Test connection" uses `{ returnMeta: true }` and names the model that
  actually answered, plus whether in-app actions are available on it.
- Settings shows the active model under the Gemini panel.

---

### C. Mobile navigation bar

The v1.2.0 pass consolidated ~6 conflicting CSS definitions into one canonical
block, but that block still gave mobile the *desktop* design at a smaller
size: a floating icon-only pill with 46px targets and no text labels. A 5-way
icon row with no labels is a guess.

Mobile and desktop are now two different layouts from one canonical block:
- **Mobile (<768px):** edge-to-edge bar pinned to the bottom, honouring the
  home-indicator safe area, icon + text label, 5 equal columns, 52px targets.
- **Desktop (≥768px):** the floating centred glass pill, icon-only, labels
  hidden via CSS.

Three stray `.bottom-nav-wrap` padding rules elsewhere in the stylesheet
(`padding-left/right: max(12px, var(--sal))`, an `@media (max-width: 430px)`
override, and a duplicate `padding-bottom`) were removed — they inset the
new edge-to-edge bar and double-counted the safe area. The rule against
adding `.bottom-nav*` / `.nav-item` rules outside the canonical block now also
covers `.nav-label`.

---

### D. Top banner replaced

The banner was a full-width glass slab reading "School Center / Abdullah
Massraf · Fall 2026 · Mechanical Eng". The subtitle was static information the
only user of the app already knows, and the slab pushed every screen's content
down by roughly 96px.

Replaced with a single hairline-separated app bar (~44px): wordmark left, term
chip and a portfolio link right. The portfolio link points to
`https://abdullahmassraf.github.io/Portfolio/` (exported as `PORTFOLIO_URL` in
`src/app.js`), opens in a new tab with `rel="noopener noreferrer"`, and
collapses to an icon-only button under 430px. Two later `.app-header` glass
overrides were deleted, and `.app-header` was removed from the shared
glass-surface selector list — search "APP BAR" in `src/style.css`.

---

### E. App background

`createLavaEngine()` painted four fully-saturated radial blobs at 0.65 alpha
over a navy base, every animation frame, behind every glass surface in the
app. That is the source of the blurry-background complaint and a constant
repaint cost on mobile.

The canvas engine (~90 lines), the `<canvas id="lava-canvas">` element, the
`#lava-vignette` element, the `--lava-a`…`--lava-d` tokens and the
`setColors()` theme wiring are all removed. The replacement is pure CSS: a
near-monochrome graphite field (`--bg-1: #0B0C10`, `--bg-2: #101118`,
`--bg-3: #0D0E13`) with exactly one low-opacity accent wash top-left, a cool
counter-wash bottom-right, a fine grain layer to prevent banding on wide
displays, and a vignette. No canvas, no animation, no repaint cost.

`THEME_PRESETS[*].lava` is retained **only** as swatch-gradient data for the
theme picker in Settings. The "Lava lamp opacity" slider is now "Background
intensity" and drives `--bg-glow`; the old `--lava-opacity` variable and the
`sc_lava_opacity` localStorage key are still written so existing saved
settings load unchanged. `#lava-canvas` / `#lava-vignette` keep a
`display: none` rule so a cached older `index.html` cannot leave a stray black
rectangle on screen.

---

### F. Campus map rebuilt to match the real Davis Campus map

The v1.2.0 map was an admitted stylized schematic — generic rounded rectangles
at invented positions, with emoji (🚌, 📍) and hard-coded font sizes.

`src/campus-map.js` is rewritten as a trace of the official Davis Campus map:
- **Real footprints.** Buildings A, B, C, H, J, M are SVG `path` polygons
  following their actual outlines, not rectangles. Union Central, the Student
  Residence, and the Peel Region child care building are included as
  secondary structures.
- **Real site context.** Steeles Ave W, McLaughlin Road, the internal service
  drives, the entrance roundabout, the bus stop, the shuttle bus location
  pin, and Lots 1, 2, 3 (Visitor Parking), 4 (Staff), 5 and 6 in their true
  relative positions.
- **Circular cutout.** The whole plan is masked by an SVG `clipPath` circle
  with a hairline ring, matching the reference concept.
- **No emoji.** The shuttle marker and the "Show location" button glyph are
  vector paths.
- **App type and colour only.** Every text class sets `font-family: inherit`,
  so map labels use the same stack as the rest of the app. Colour comes only
  from `--accent`, `--accent-3`, `--ink`, `--muted`, `--muted-dim`.

**Coordinate system (important if you re-trace):** viewBox is `0 0 930 1000`,
derived from the source artwork by `x' = (x_src − 150) × 1.176`,
`y' = (y_src − 155) × 1.176`. Keep that transform so existing coordinates stay
valid. Building geometry lives in `CAMPUS_BUILDINGS` (`d` = footprint path,
`badge` = letter pill position, `pin` = marker drop point); every visual choice
lives in `src/style.css` under "CAMPUS MAP WIDGET".

---

### Files changed
- `index.html` — removed the `<canvas id="lava-canvas">` / `#lava-vignette`
  background markup.
- `package.json` — version 1.2.0 → 1.3.0.
- `src/app.js` — new app bar + portfolio link; nav labels; Gemini request
  layer rewritten (model chain, tools-optional retry, `sanitizeHistory()`,
  model caching, `returnMeta`); removed the racing bootstrap
  `startAutomaticDataSync()` call; deleted `createLavaEngine()` and its
  `--lava-*` wiring; Settings shows realtime status and active AI model; new
  state fields `aiLastModel`, `aiToolsDisabled`, `dataSyncRealtime`,
  `dataSyncRealtimeNote`; background slider drives `--bg-glow`.
- `src/campus-map.js` — full rewrite (see F).
- `src/data-sync.js` — single-flight start, `teardownChannels()`,
  `onChannelStatus()`, adaptive `schedulePeriodicSync()` with backoff,
  `visibilitychange` wake, `getDataSyncStatus()` export, clearer sign-in error.
- `src/ai-history.js` — `getCurrentAiUser()` uses `getSession()` first.
- `src/style.css` — new palette tokens and static background; "APP BAR" block
  replacing `.app-header`/`.header-meta` and two later overrides; canonical
  bottom nav rewritten for mobile; three stray `.bottom-nav-wrap` padding
  rules removed; campus map styles rewritten.
- `UPDATE-CATALOG.md` — this entry.

### New files
None.

### Files deliberately NOT touched
Everything else in the repository, including
`school-center.html`, `school-center-STATIC-BACKUP.html`, all `supabase/`
migrations and functions, all `scripts/`, and the entire `Sheridan/` course
content tree. Replace only the files listed above.

### Database changes
None. No new tables, columns, policies, or migrations. This release still
assumes `supabase/migrations/002_user_notes_assignments.sql` has been run —
if it has not, the sync error banner will now say so explicitly.

### Configuration changes
None. No new environment variables, keys, or Edge Functions. One new
localStorage key is written automatically: `sc_gemini_model` (the last Gemini
model that answered successfully). Clearing it just re-runs the fallback chain.

### Testing performed
- `node --check` passes on every file in `src/`.
- Every local `./*.js` import in `src/` resolves to a real file.
- CSS brace balance verified: 720 open / 720 close. (A stray extra `}` was
  introduced and caught during the nav rewrite.)
- Campus map badge positions verified by point-in-polygon against each
  building's footprint path.
- Confirmed no references to `createLavaEngine`, `lavaEngine`, `--lava-a`,
  `header-meta`, or `lava-canvas` remain in live code.

### NOT verified in this environment
No browser or network access here, so the following need your eyes:
- **The campus map's visual fidelity.** Coordinates were derived
  arithmetically from the source image, not checked against a render. This is
  the item most likely to need nudging. Adjust the `d` paths in
  `CAMPUS_BUILDINGS` and the `PARKING_LOTS` rects.
- **Two-device sync.** Sign in with the same email in Settings on two devices,
  create a note on one, confirm it appears on the other. With realtime healthy
  it should be near-instant; if Settings says "Syncing periodically", expect
  up to 15 seconds.
- **Which Gemini model actually answers.** Press Test connection; the toast
  names it. If it reports `gemini-2.5-flash`, the newer IDs in the chain are
  not available to your API key and the chain order should be adjusted.
- **The mobile nav bar and app bar** on a real phone, including safe-area
  behaviour on a notched device.

### Known limitations / follow-up work
- The model fallback chain is a hard-coded list. A more durable approach is to
  call the `ListModels` endpoint and pick the newest available flash model at
  runtime; that is a larger change and was not attempted here.
- Realtime degradation is detected per-channel but not retried — once
  degraded, the session stays on the 15s poll until reload. Automatic
  re-subscription after a network recovery is follow-up work.
- The magic-link flow uses PKCE, so the emailed link must be opened on the
  same device that requested it. This is expected supabase-js behaviour, not a
  bug, but the Settings copy could say so more directly.
- Still queued from earlier releases: search UI polish, "stay on last page
  after refresh", and AI chat history cross-device sync verification.
