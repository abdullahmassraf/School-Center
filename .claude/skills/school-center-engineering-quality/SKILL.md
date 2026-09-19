# School Center Engineering Quality

Use this skill for every School Center bug fix, feature, refactor, Supabase change, sync change, QA pass, and production-facing change.

## Operating priority

Prioritize, in order:

1. Correctness
2. Reliability
3. Recoverability
4. Security
5. UX
6. Performance
7. Maintainability

Treat School Center as a production academic operating system, not a demo. Preserve the existing architecture and prefer the smallest safe change.

## Required workflow

### 1. Understand before editing

Inspect the repository structure, README, update catalog, package configuration, recent Git history, relevant modules, tests, Supabase migrations/configuration, and deployment workflow. Trace the complete path involved:

```text
UI → state → configuration/auth → Supabase/Storage/Realtime → processing → rendering
```

Use source code and observed behavior as the source of truth; treat documentation and prior assumptions as leads to verify.

### 2. Reproduce and record

For bugs, attempt reproduction before changing code. Record:

- Expected behavior
- Actual behavior
- Reproduction steps
- Failure point
- Evidence and confidence (`VERIFIED`, `REPRODUCED`, `OBSERVED`, `INFERRED`, `BLOCKED`, or `UNKNOWN`)

If reproduction is not possible, say so and do not invent a root cause.

### 3. Identify the root cause and plan

Trace the failure to the actual layer. Before editing, state:

```text
Root cause:
Files affected:
Why these files:
Change:
Regression test:
Production verification:
Risk:
```

Do not fix only the visible symptom, rewrite working infrastructure, weaken validation/RLS, delete tests, or apply migrations without explicit investigation and documentation.

### 4. Implement safely

Make focused edits and preserve unrelated user changes. Every network or cloud operation must have a justified finite outcome: success, failure, cancellation, or timeout. For each `await` ask: **what happens if this Promise never resolves?**

Use operation-appropriate timeouts, cancellation where practical, classified errors, bounded retries/backoff, and a visible recovery path. Keep `LOADING`, genuine `EMPTY`, and `ERROR` states distinct. Never turn a timeout or backend failure into an empty result.

Retries must be limited and safe for the operation. Distinguish transient network stalls, offline state, authentication, configuration, RLS/database errors, validation errors, and permanent failures.

Treat localStorage as a cache/local working state; Supabase is authoritative for cross-device data. Realtime is an accelerator, not the only synchronization mechanism. Periodic reconciliation must remain alive after failures, duplicate events, reloads, offline periods, reconnects, multiple tabs, and simultaneous edits.

Preserve uploaded documents when later processing fails, and keep document/background-job stages observable: queued, active, progress, completed, failed, cancelled, retryable, and error detail.

Never expose service-role keys, database passwords, Gemini secrets, or personal access tokens. Never weaken RLS to hide a bug. Inspect migrations before schema work and never claim production changes were applied unless verified.

### 5. Test the failure, not only success

Run the strongest applicable tests and record exact commands/results:

- Syntax/type checks and relevant unit/regression tests
- Normal success path
- Slow and permanently stalled requests
- HTTP/server failure and unauthorized/auth-expired cases
- Genuine empty response
- Duplicate request/event and race-before-hydration
- Reload, stale cache, offline, reconnect, and multiple tabs
- Realtime failure with periodic fallback
- Two-browser/device behavior
- Mobile viewport/accessibility where UI is affected
- Actual production deployment and browser/network behavior when applicable

Adversarial review question: **How could this still fail?** Try the likely failure modes after the happy path passes.

### 6. Final quality gate

Before completion, inspect the diff and changed files. Confirm correctness, finite async behavior, recovery, UX clarity, security, performance, regression risk, maintainability, test coverage, and documentation impact. Search for new silent catches, unbounded cloud awaits, misleading empty states, dead retry loops, and unobservable background failures.

Verify production through the real chain when relevant:

```text
source → commit → GitHub → Pages → browser → Supabase → Storage/Realtime
```

Do not call a change deployed because a push succeeded; verify the deployment and the actual behavior. Never claim a test, database response, cross-device sync, or production result that was not observed.

## Git and reporting

Preserve unrelated changes and stage only files belonging to the current task. Before a requested commit, inspect `git diff` and recent `git log`; use a precise why-focused commit message. Do not push, commit, merge, or alter history unless explicitly requested.

Report every substantial task with:

- Result
- Root cause
- Exact files changed
- Tests and exact outcomes
- Production verification status
- Remaining risks or blockers
- Git commit/push status
- Required user action, only when genuinely necessary

Use explicit status language: `VERIFIED`, `REPRODUCED`, `OBSERVED`, `INFERRED`, `NOT TESTED`, `BLOCKED`, and `UNKNOWN`.
