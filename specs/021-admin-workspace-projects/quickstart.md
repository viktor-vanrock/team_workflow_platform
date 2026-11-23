# Quickstart

Run with Node24: pnpm exec vitest run tests/integration/021 --maxWorkers=1; pnpm exec playwright test tests/e2e/021 tests/e2e/020 tests/e2e/019 --project=chromium --workers=1. Run root types, changed-file lint, architecture and web build. PostgreSQL and local OIDC used; no real corporate credentials.

Live: node tools/local/pilot-cli.mts up without reset. Admin1: open /projects/new, verify three named destinations, select documentation, verify its owners and current UI. Admin2 and QA cannot choose/create outside granted scopes. Verify bootstrap replay and revocation in disposable database; live check non-mutating options/invalid writes and preserve existing task/document hashes.
