# Validation quickstart

Use Node 24.20.0 and pnpm 11.21.0, per README.

1. `pnpm dev:pilot:up`; open http://localhost:55173. Fresh entry explains roles. Choose Заказчик · ALPHA, sign in.
2. Main shows role/project and actions. Navigate to new request, requests, queue, help and back without another login. Developer forms are separate.
3. Create a request with a unique title; review snapshot. Choose edit, change title, save again; confirmation must concern only the new snapshot. Send explicitly; observe processing and then confirmed result. Open the exact created request.
4. With two requests switch selection while on sessions/evidence. Data and commands must follow selected request. Switch to BETA or a role without project; no old ALPHA data remains.
5. Keyboard: tab to entry/actions, operate selects, navigate tabs. At 390 px verify no whole-page horizontal scrolling.
6. Run `pnpm exec playwright test tests/e2e/013/workspace-browser.spec.ts --project=chromium --workers=1`, then format/lint/typecheck/build, `pnpm architecture`, localization and affected QA UI Vitest suites.

Browser fixtures test delayed/error/denied states; real pilot verifies integration. This does not assert measured usability improvement for a population. Record evidence and limits in validation.md.
