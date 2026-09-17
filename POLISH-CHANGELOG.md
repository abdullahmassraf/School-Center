# School Center — Polish Pass Changelog

Every item below was diagnosed by reading the actual code you shipped (not guessed), then fixed
in that code. Grouped by the list you gave.

## 1. "No chat history for AI (delete chat, edit texts, delete texts)"
- Chat history *was* already being saved (locally always, cloud when signed in) — but the
  Supabase email-link bug below meant cloud sign-in never actually completed, so it never felt
  reliable across devices.
- **Added:** per-message **Edit** (user messages) and **Delete** buttons (hover a message to
  see them), and a **Clear conversation** button in the AI & Search page header. All three write
  through to Supabase when you're signed in, and to local storage either way.
- Files: `src/ai-history.js` (new `deleteAiMessage`, `updateAiMessageText`, `clearAiConversation`),
  `src/app.js` (UI + handlers), `src/style.css` (`.ai-message-controls` etc.)

## 2. "AI cannot generate photos" / "no ability of time" / "no internet"
- **Time:** confirmed the Gemini system prompt never included the current date/time at all — the
  AI genuinely had no way to know "today." **Fixed**: real current date/time is now injected into
  every request.
- **Photos / internet:** these are real limits of the current Gemini text-chat integration, not
  bugs. Rather than let the AI guess or hallucinate, the system prompt now tells it to say
  plainly it can't do these instead of pretending. Actually adding image generation or live web
  search is a real scope decision (different model / new tool / cost) — didn't want to bolt that
  on silently; happy to spec it out if you want it next.
- File: `src/app.js` (`buildGeminiSystemPrompt`)

## 3. "Search is buggy / glitchy animation"
- Found it: the composer was calling a **smooth scroll-to-bottom on every single keystroke**
  while you were typing a search — that's what produced the jumpy feel. It now only auto-scrolls
  while browsing the conversation, not while a search query is active.
- File: `src/app.js` (`syncAiInput`)

## 4. "Notes don't sync (push to cloud / sync from cloud do nothing)"
- Confirmed: `src/notes.js` and `src/assignments.js` were **100% localStorage**, with **zero**
  Supabase calls. "Push to Cloud" was a literal no-op (just a toast). "Sync from Cloud" only ever
  pulled course/material data, never notes or assignments. The Settings copy claiming they "stay
  synchronized" was not true in the code.
- **Fixed for real:**
  - New tables `user_notes` / `user_assignments` (`supabase/migrations/002_user_notes_assignments.sql`),
    RLS-scoped to the signed-in user, reusing the *same* magic-link account as AI chat history —
    no second login system.
  - New `src/data-sync.js`: `pushLocalDataToCloud()`, `pullCloudDataToLocal()`, `fullTwoWaySync()`.
  - "Push to Cloud" / "Sync from Cloud" / "Sync now" in Settings now actually call these.
  - Signing in on a new device now auto-pulls your notes/assignments, the same way it already did
    for AI chat.
  - Any local note/assignment edit now **auto-pushes** ~2.5s later if you're signed in, so you're
    not relying on remembering to hit the button.
  - **You must run the new migration once** (see README-FIRST.txt) or these tables won't exist yet.

## 5. "Nav bar should hide, and reveal on hover (desktop only), avoiding the very bottom edge"
- Implemented: on desktop (hover-capable pointer, ≥769px), the bottom nav sits just off-screen
  and slides up when you hover a strip near the bottom — with a small gap left above the true
  screen edge specifically so it doesn't fight Windows' own taskbar auto-reveal trigger. Untouched
  on mobile/touch.
- Files: `src/app.js` (`renderBottomNav` now emits a `.nav-hover-zone`), `src/style.css`

## 6. "AI/Search page loads cut off, need to scroll"
- Found it: the page's height was computed as `100dvh minus a hard-coded guess at the nav bar's
  height` (126px desktop / 92px mobile). If the real nav height ever differed — and it easily
  could, since `.bottom-nav-wrap` was defined **four separate times** in the stylesheet with
  conflicting rules — the page came up short and needed a scroll to reveal the rest.
- **Fixed properly:** replaced the guessed offset with a standard flexbox fill (`#app` is now a
  column flex container; the active view and the AI page stretch to fill exactly what's left),
  so it's correct regardless of the nav's actual rendered height.
- File: `src/style.css`

## 7. "UI really sucks — icons/sizing not thoughtful"
- **Not fully addressed in this pass** — I want to be upfront about that rather than claim a
  blind rewrite fixed it. What I found: the stylesheet (`src/style.css`, ~3,600 lines) has
  several classes defined multiple times in different places with conflicting `!important`
  rules (e.g. `.bottom-nav-wrap` appears 4 times). That kind of accumulated duplication is very
  likely a real contributor to inconsistent spacing/sizing you're seeing. A full, confident
  visual redesign needs an iterate-and-look loop (screenshots, live reload) that this chat can't
  do — that's a much better fit for Claude Code pointed at this repo, where I can run the dev
  server, take screenshots, and actually see what I'm changing before calling it done. I'd
  recommend that as the next step for this specific item.

## Everything else in this ZIP
Untouched from what you sent — this pass only touched the files listed above plus this changelog
and the README-FIRST update.
