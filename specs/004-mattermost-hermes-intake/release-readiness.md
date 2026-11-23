# Release readiness: Mattermost and Hermes intake

Feature 004 is scoped to the local `qa-jira-mattermost-local` contour. The required handoff is the cryptographically bound `reports/004-mattermost-hermes-intake/final-gate.json` produced after the complete verification matrix.

Release decision: READY when final-gate status is PASS

- Local contour: required `PASS`.
- PostgreSQL: required `PASS` on 17 and 18 for fresh, 003→004 upgrade, repeat, failed recovery and legacy Draft backfill.
- Stories: US1–US4 required `PASS` through contract, integration, security, browser and real-process evidence.
- Optional live Mattermost/model: `PASS` or honest `SKIPPED_GATED`; neither is required for the local release.
- Production: DENIED
- Production writes: unsupported.
- Constitutional exceptions: none. No constitution amendment or exception is required for this implementation.

Operators must verify the final report with `corepack pnpm verify:004:evidence`. Any task, source, contract, runtime, test or tool change invalidates the bound handoff and requires a complete gate rerun.
