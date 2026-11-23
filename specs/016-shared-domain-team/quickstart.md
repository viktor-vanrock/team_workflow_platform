# Quickstart validation

Use installed workspace dependencies and Docker for disposable PostgreSQL tests. Do not reset the user's database.

1. `AWP_RUN_CONTAINER_TESTS=true pnpm exec vitest run tests/unit/016 tests/integration/016 tests/integration/007/local-project-bootstrap.spec.ts tests/integration/security/008/corporate-identity.spec.ts --maxWorkers=1`
2. `pnpm exec playwright test tests/e2e/016 --project=chromium --workers=1`
3. `pnpm typecheck:root`, `pnpm lint`, `pnpm --filter @awp/web build`, formatting and architecture checks.
4. Upgrade local runtime with migrations and versioned seed; never local:reset. Login QA 1, switch ALPHA/BETA with «Рабочий проект», then login QA 2 and repeat. Same role, distinct people.
5. Click all breadcrumbs; navigate using keyboard. Try retired auditor, foreign DELTA, revoked membership and denied permission in integration tests: access denied.
6. Register a project in disposable integration database: both QA people have explicit revisioned entitlements included in onboarding starter set. Repeated registration/seed creates no extra grants.
7. On an existing local seed, open the ALPHA/BETA project breadcrumb. Both pages must load without `ONBOARDING_REVISION_UNVERIFIED`; historical revisions remain present and projects do not acquire readiness or pilot activation.

Record actual commands and results in validation.md; do not mark unavailable checks passed.
