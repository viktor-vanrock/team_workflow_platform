# Quickstart verification

Use Node 24.20.0 and pnpm 11.21.0; Docker test databases are disposable. Do not reset the user's local database.

1. Run focused feature 017 unit/integration/browser suites plus affected authorization and historical role compatibility tests.
2. Run root typecheck, lint, formatting, architecture and web build.
3. Upgrade via `node tools/local/pilot-cli.mts up`, preserving all volumes.
4. Check both QA personas: common queue and request list, ALPHA/BETA labels and task links, no global project selector, project selection only in new-request form.
5. Check breadcrumbs on home, queue, list, task, project, documentation; direct destination across login; back/forward.
6. Select named request/candidate/draft in Hermes. Confirm correct subject/project, empty/error handling and no free-text ID requirement.
7. Check every remaining persona's menus, direct routes, read data and write controls; record roles/access evidence with allowed and denied scenarios.
8. Compare document/task/history counts before and after; confirm retired auditor remains absent and old roles have no live assignments.
