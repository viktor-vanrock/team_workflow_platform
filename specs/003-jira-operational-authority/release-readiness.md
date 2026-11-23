# Feature 003 release readiness

Feature `003-jira-operational-authority` is release-ready only when `reports/003-jira-operational-authority/final-gate.json` has status `PASS` and `pnpm verify:003:evidence` confirms its task, runtime and referenced-report hashes. A missing, failed or drifted report is not a release decision; validation atomically invalidates a stale PASS.

## Required evidence

| Area | Authoritative evidence |
|---|---|
| prerequisites and boundaries | `prerequisites.json`, `setup-gate.json`, `foundation.json` |
| independent user stories | `us1.json`, `us2.json`, `us3.json`, `us4.json` |
| PostgreSQL 17/18 migration and recovery | `migrations.json` |
| deterministic local E2E and documented commands | `smoke.json`, `quickstart.json` |
| FR/SC/source-of-truth/contracts | `traceability.json` |
| optional real non-prod Jira | `nonprod-metadata.json`, `nonprod.json` (`SKIPPED_GATED` is visible and acceptable for local release readiness; it is never reported as live PASS) |
| aggregate decision | `final-gate.json` |

The aggregate gate also runs all-workspace typecheck, lint, build, unit regression, Feature 003 contract/integration/security/E2E suites, API/schema drift, and the deterministic local scenario.

The aggregate report is written as `RUNNING` before process gates start. A `BOUND` handoff attestation is generated atomically only after every process gate and required evidence status passes. It pins the exact `tasks.md` completion state, the scoped runtime/test/configuration tree and the bytes plus status of every authoritative child report, so later drift requires a complete gate rerun.

## Post-design constitution decision

Decision: no constitution amendment and no exception are required.

- Human Jira writes use action-specific exact one-time approval and revalidate authorization/configuration at effect time.
- Jira remains authoritative for operational fields; webhook payloads only schedule authoritative reads.
- Idempotency, ambiguity handling, append-only projections/audit, project isolation, least privilege, and secret redaction have executable evidence.
- The residual Jira REST time-of-check/time-of-use limitation remains explicit. Deployments requiring strict atomic no-overwrite must use a validated `JIRA_SIDE_CAS` capability; `COMPARE_AND_VERIFY` requires its pinned risk acceptance and does not weaken the invariant silently.
- Production Jira writes remain outside Feature 003. Real validation is limited to an explicitly supplied, attested, allowlisted `NON_PROD` target and uses read-only conformance endpoints in the automated gate.

The final machine-readable report records this as `constitutionalExceptions: 0` and links this decision document.
