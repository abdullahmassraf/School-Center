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
