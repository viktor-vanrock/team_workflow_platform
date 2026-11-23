# Stage 0 Baseline

**Recorded:** 2026-08-30  
**Workspace:** `PlatformWorkspace`  
**Result:** PASS

## Environment

- Node.js: `24.20.0`
- pnpm: `11.21.0`
- Nx: `23.1.2`
- Docker client/server: `24.0.5`
- Docker Compose: `2.20.2-desktop.1`
- Default PostgreSQL image: `postgres:18.6-bookworm`
- Compatibility matrix: `postgres:17.7-bookworm`, `postgres:18.6-bookworm`

## Verification

| Check | Result |
|---|---|
| Frozen offline install | PASS |
| Prerequisites | PASS |
| Contract registry | PASS — 31 schemas |
| Architecture | PASS — 18 projects |
| ESLint | PASS |
| Typecheck | PASS — 18/18 projects |
| Build | PASS — 18/18 projects |
| Full Vitest suite | PASS — 38 files, 82 tests |
| Setup gate | PASS |
| Foundation gate | PASS — 9 files, 26 tests |
| US2 extension checkpoint | PASS — 6 files, 10 tests |
| US3 configuration checkpoint | PASS — 12 files, 24 tests |
| US3 durable checkpoint | PASS — 19 files, 42 tests |

## Stage 0 Changes

- Testcontainers cleanup is guarded in every existing PostgreSQL suite, so a setup failure is not masked by a secondary teardown error.
- PostgreSQL local/default execution is aligned with the documented `18.6` baseline; PostgreSQL `17.7` remains the compatibility branch.
- `.pnpm-store/` is excluded from Git.
- A new local Git repository was initialized on `main` because no prior `.git`, origin URL, or recoverable repository history was present.

## Non-blocking Follow-ups

- No Git remote is configured; an origin must only be added from a confirmed URL.
- The Web production bundle is `1,219.83 kB` (`302.59 kB` gzip) and exceeds Vite's 500 kB warning threshold.
- Backend build targets currently validate with `tsc --noEmit`; deployable server output remains part of the later local-runtime work.
- Before T137, confirm the required multi-architecture digest for `postgres:18.6-bookworm`.
