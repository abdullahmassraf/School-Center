---
name: school-center-engineering-quality
description: Use this skill for every School Center bug fix, feature, refactor, Supabase change, sync change, QA pass, and production-facing change.
---

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