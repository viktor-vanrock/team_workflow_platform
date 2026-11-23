# Stage 2 Local Walking Skeleton

**Recorded:** 2026-08-30
**Feature:** `001-extension-kernel-local-skeleton`
**Scope:** Phase 7 / T127–T145
**Result:** PASS

## Delivered

- HTTPS-only Fake IdP with repository CA, SAN `fake-idp`, discovery/JWKS, ES256 tokens and retained-key rotation.
- Nine backend-verified local personas; the browser sends only a persona key while roles, entitlements and classification ceiling are resolved from PostgreSQL.
- Deterministic model fallback for unset, invalid and timeout scenarios without Mock Hub or external model dependency.
- Authenticated S3-compatible adapter with local endpoint gate, SigV4, bucket versioning, exact object version and checksum validation.
- Versioned, idempotent Core+Dummy seed and separately owned Mock Hub migrate/seed path.
- Local API, worker, React shell, OpenAPI 3.1 document, Dummy intake, connector command, optional Approval and authorized artifact proxy.
- Exact tag+digest Compose for Node 24.20.0, PostgreSQL 18.6, Redis 8.2.9, Adobe S3Mock 5.1.0 and optional OTel Collector.
- Internal-only application network plus a no-secret, fixed-route localhost edge proxy. API and worker can reach local providers but have no public egress.
- Safe local CLI, scenario control, explicit reset confirmation, Playwright CA pinning, repeatable smoke and US1 checkpoint.

## Runtime Status

The local stack remains running and healthy after verification.

| Surface | URL |
|---|---|
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| API readiness | `http://localhost:3000/health/ready` |
| OpenAPI 3.1 | `http://localhost:3000/api/docs` |
| Mock Hub | `http://localhost:4010` |
| Fake IdP TLS edge | `https://localhost:4443/oidc` |
| S3Mock edge | `http://localhost:9090` |

PostgreSQL, Redis, S3Mock, Fake IdP, Mock Hub, API, worker, web and edge proxy are healthy. Core/Mock migrations, Core/Mock seeds and S3 initialization exit successfully as one-shot services.

## Verification

| Check | Result |
|---|---|
| Contract registry | PASS — 31 schemas |
| Architecture graph | PASS — 18 projects |
| ESLint | PASS |
| Typecheck | PASS — 18/18 projects |
| Build | PASS — 18/18 projects |
| US1 acceptance + live storage | PASS — 4 files, 18 tests |
| Playwright Chromium | PASS — 1/1 walkthrough |
| Smoke 001 | PASS — 10/10 checks |
| Full Vitest suite | PASS — 50 files, 131 passed, 1 skipped |
| Diff whitespace validation | PASS |

The live storage harness writes a marker, removes and recreates only the S3Mock container, then reads the same exact version/checksum from the retained named volume. It also proves expired artifact bytes remain in raw storage while the backend returns HTTP 410, and statically proves `--volumes` is reachable only through the confirmed reset command.

The smoke verifies `runtime.profile=local`, all six API dependencies `UP`, backend-issued ES256 sessions, Dummy intake, idempotent command replay with one effect, exact Approval consumption, correlation projection, artifact checksum, classification 403, expiry 410 and container-level public-egress denial.

## Commands

```bash
pnpm local:up
pnpm local:status
pnpm verify:us1
pnpm smoke:001
pnpm local:logs -- api worker
pnpm local:down
pnpm local:reset -- --yes
```

`local:down` preserves named volumes. Only `local:reset -- --yes` removes the project-scoped PostgreSQL, Redis and S3Mock volumes.

## Speckit State

- T127–T145 are marked complete in `tasks.md`.
- No feature checklists were present.
- `.specify/extensions.yml` is absent, so no extension post-hooks apply.
- The next stage is Phase 8 / T146–T163 hardening, traceability and final handoff.
