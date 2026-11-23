# Feature 007 capability and authority contract

## QA-owned logical roles

| Capability | Logical role | Required for |
|---|---|---|
| `operational-work-item` | `QA_REQUEST_AUTHORITY` | MANUAL_ONLY and FULL_QA |
| `operational-work-item` | `SOURCE_CONTEXT` | MANUAL_ONLY and FULL_QA |
| `operational-work-item` | `DEFECT_DESTINATION` | MANUAL_ONLY and FULL_QA |
| `source-context.read` | `SOURCE_CONTEXT` | FULL_QA |
| `test-executor.trigger-status` | `TEST_EXECUTION` | FULL_QA |
| `artifact.ci-read` | `ARTIFACT_SOURCE` | FULL_QA |
| `messaging.interaction` / `messaging.notification` | `MESSAGING` | P3 readiness; outage uses web/outbox fallback |

Logical roles are opaque to Platform Core. `competency-qa` publishes their
requirement matrix and deterministic evaluator. Core validates exact contract
versions, environment scopes and Profile/Connection/Mapping chains.

## Capability-mode rules

`MANUAL_ONLY` requires a published Project Binding, valid Jira role entries, a
published QA Project Context, all mandatory manual probes and an ACTIVE Project.

`FULL_QA` requires all `MANUAL_ONLY` facts plus the three GitLab automation roles,
an exact accepted suite binding and fresh mandatory probes.

Mattermost is required for pilot onboarding but its runtime outage does not change
the QA mode. Chat intake/notifications degrade to web and durable outbox behavior.

## Administrative actions

| Action | Initiator | Additional authorization |
|---|---|---|
| Register Project / change registry draft | Integration Administrator | no Project content grant implied |
| Grant/replace/revoke entitlement | Workspace Owner with exact `project.admin` scope | current authorization and CAS |
| Validate Binding | Integration Administrator | exact candidate and current configuration permission |
| Accept Binding semantics | QA Lead | Project entitlement and exact checklist/context refs |
| Publish/retire Binding | Integration Administrator | distinct Workspace Owner exact one-time Approval |
| Emergency suspend | Integration Administrator | direct fail-safe command; reason and incident required |
| Resume | Integration Administrator | fresh probes + incident disposition + distinct Workspace Owner Approval |
| Acquire/release account lease | authorized QA HUMAN/SERVICE per policy | ACTIVE Project and exact resource refs |
| Verify/read/export evidence | authorized HUMAN | entitlement, role and classification; export is audited |

Hermes cannot initiate, approve or consume any administrative action in this table.

## Effect guard

Every new external write, Session start and lease acquisition checks Project state
at intent creation and again immediately before the first effect. `SUSPENDED`
denies them regardless of preserved capability mode. Read-only investigation,
signature verification and reconciliation of an already invoked exact command
remain available to authorized actors.

## Production boundary

Feature 007 supports only `LOCAL`, `NON_PROD` and `PREPROD` QA targets. Product-
production targets, production test runs, deployment operations and release
decisions are forbidden by schema, runtime policy, credential scope, network policy
and acceptance tests.
