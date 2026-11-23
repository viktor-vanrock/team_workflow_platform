# Quickstart validation

Use Node 24.20.0 and installed pnpm. Run `pnpm exec vitest run tests/integration/020 --maxWorkers=1`, `pnpm exec playwright test tests/e2e/020 --project=chromium --workers=1`, affected 016/017/019 browser tests, root typecheck, focused lint, architecture and web build. Docker access is needed for disposable database tests.

In a disposable test database, admin creates a project through the published HTTP/UI flow, selects named owners, repeats identical request once, then both QA read the project; nonadmins and platform-only identity denied. On the existing live stand verify the form and denied invalid writes, preserving business data.

At /qa/queue compare mixed, all-pending, empty and paged responses; open each task with the correct project; reload after data changes and test stale cursor. Verify summary first and no horizontal page overflow at 390/1440 px. Live stand upgrade: `node tools/local/pilot-cli.mts up` without reset. Store validation, screenshots and retention comparisons in this feature directory.
