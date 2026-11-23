# Quickstart

Use Node 24.20.0, pnpm and Docker. Do not reset the user's volume.

1. Run Vitest `tests/unit/018`, `tests/integration/018`, affected seed and access regression tests with `--maxWorkers=1`.
2. Run Playwright feature 017/016 browser regressions; root typecheck, lint and architecture.
3. Record existing local document/task/history data and membership state.
4. Run `node tools/local/pilot-cli.mts up` with existing volumes.
5. Verify `/local/personas` has nine humans; direct exchanges for `limited.alpha`, `outsider.delta`, `worker.local` are 403. Verify both QA, reader and administrators exchange successfully.
6. Verify SQL has no retired memberships/roles/active entitlements, worker is still SERVICE with grants, and document/task/history content is retained.
7. Re-run seed and verify unchanged marker/state. Open local login and inspect nine options.
