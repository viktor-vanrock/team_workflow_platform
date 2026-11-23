# Pilot operations contract v1

## Authorization and commands

Reads authorize before lookup/counting. Multi-project reports require access to
every included Project or return a separately hashed filtered projection. Mutations
bind requestId, workspaceId/projectId, expectedVersion, idempotencyKey, exact
target/config/report refs and reason. Resolve actor/role server-side. Audit scope,
semantic hash, authorization basis, decision and correlation. Same key/hash replays;
different hash or stale version conflicts. Errors contain redacted reasons.

Preserve existing 007 action identity and endpoint for ONBOARDING_PILOT_ACTIVATE
and resume. Complete the currently partial activation consumer: immutable exact
candidate prerequisites, current rights, persisted Approval consumption, durable
rollout lease, onboarding revision, audit and outbox in one transaction. Use a
transaction-scoped lease adapter following existing administrative lock order;
do not nest acquireFirstPilotRolloutLease's current independent transaction.
The current in-memory activation service and receipt-only API are not sufficient.

Never consume a second action ref or add a bypass activation route. Direct emergency
suspension retains the existing audited human command.

## Planned routes

| Method/path | Meaning |
|---|---|
| GET /api/v1/workspaces/:workspaceId/projects/:projectId/pilot/deployments/:id/readiness | Operator-scoped exact input/gate status |
| GET /api/v1/workspaces/:workspaceId/projects/:projectId/pilot/health | Authorized capability/binding health/freshness |
| POST /api/v1/workspaces/:workspaceId/projects/:projectId/pilot/evidence-imports | Verify and append one immutable report execution; exact replay returns the existing record |
| GET /api/v1/workspaces/:workspaceId/projects/:projectId/pilot/dead-letters | Bounded paginated owner/age/replay eligibility |
| POST /api/v1/workspaces/:workspaceId/projects/:projectId/pilot/replay-decisions | Pin safe decision for original command; required original approval remains enforced |
| GET /api/projects/:projectId/pilot/recovery-runs/:id | Authorized redacted manifest/drill/uncertainty |
| GET /api/pilot/runs/:id | Cohort/window/gates/guardrails under explicit report access |
| POST /api/pilot/runs/:id/measurement-protocols | Immutable protocol and exact human attestations |
| POST /api/pilot/runs/:id/baseline-imports | Bounded scoped observations with provenance |
| GET /api/pilot/runs/:id/metrics | Authorized aggregates, completeness and denominators |
| POST /api/pilot/runs/:id/reviews | Human continue/adjust/stop/insufficient-data review; no activation |

These are additive design routes; existing onboarding routes remain canonical for
activation/resume/suspend. Register permissions through current contributions;
QA Lead/sponsor attest only their role-specific decisions. Reports omit private
locators/credentials. Lists use bounded cursors and existing snapshot conventions.

Backup/restore, deployment and secret management are scoped operator CLI/runbook
operations, never generic Hermes HTTP capabilities. Imported reports require
authenticated executor/signature, digest, scope and source/image/config checks.

### Implemented read/import boundary

The three scoped routes above require the verified HTTP identity and current Core
`pilot.readiness.read`, `pilot.health.read` or `pilot.evidence.import` permission,
with a CONFIDENTIAL classification ceiling. Authorization occurs before resource
lookup and again before disclosure or persistence. Composition must supply the
current reviewed input resolver, report policy and opaque artifact store; there
is no built-in corporate success/default adapter.

Import accepts only `{executionKey, reportRef}`; the execution key must be one of
the Core gate requirements (including the case-sensitive `N2`). It derives the
execution identity, checks and timestamps from the actual signed report. Ed25519
signatures bind exact report/key/subject references and executor identity. Policy
hash, approved public keys, every prerequisite/evidence byte hash, exact scope,
fingerprints, expiry and allowed report kind/profile are verified. Paths are
bounded opaque store references, never client-selected fetch URLs. The transaction
rechecks current request authority and verification policy, appends the execution
and one audit event atomically, and safely replays concurrent/restarted imports.
Import does not publish a Core onboarding gate or authorize activation.

Readiness selects the current scoped deployment revision and only Core gates for
that exact subject. It reconstructs each gate from imported executions and freshly
verified source reports, preserving publication order. Key revocation, fingerprint
drift, changed bytes, expiry, absent inputs or changed deployment heads block a
green result while leaving historical evidence immutable. `gateReady`,
`engineeringReady` and `corporateGatesReady` describe gate evidence only; host
readiness and effect admission retain their separate runtime guards. Health reads
existing Core probes for the exact current binding/profile/connection/mapping,
validation and capability operation; absent or expired probes derive UNKNOWN.
Read/import errors omit provider bodies, private locators and credentials.

The web entry is `/pilot/readiness`, with an optional exact scope at
`/workspaces/:workspaceId/projects/:projectId/pilot/deployments/:deploymentId/readiness`.
It uses the same-origin corporate session/login/logout BFF and must be served
behind the approved browser-origin proxy. Scoped return paths must be explicitly
allowlisted by the identity policy. Local persona modules are not mounted by this
entry. Provider tokens are never stored in browser storage; CSRF remains in the
current in-memory session. The UI cancels and clears old results on scope changes,
refresh, logout, session expiry and access failure. Evidence expiry immediately
removes green status, and visible results revalidate on focus and every 30 seconds.
Owners and follow-up actions remain visible for missing, unverified or stale inputs.

### Implemented original-command replay boundary

`PilotDeadLetterModule.register` composes the verified HTTP identity and the durable
replay service. Its three routes use the Workspace/Project prefix above:

- `GET dead-letters?limit=25&after=<command UUID>` requires `pilot.replay.read`.
  Limits are 1–100; UUID keyset cursors are scoped and results require CONFIDENTIAL
  clearance as well as clearance for every returned command.
- `POST dead-letters/:commandId/diagnostics` accepts an empty body and requires
  HUMAN `pilot.replay.decide`. It freezes the first observed terminal failure,
  original command hash, exact approval and deployment-policy owner/expiry, with
  an audit record in the same transaction. Repeated captures retain that record.
- `POST replay-decisions` accepts exactly `{commandId, recordRef,
  expectedRowVersion, requestKey, reason}`. Reason is `DEPENDENCY_REPAIRED` or
  `ACCESS_RESTORED`. Requests never contain command payloads or replacement pins.

The immutable policy has a scoped owner, exact body hash, maximum command age
(1 second–7 days) and replay budget (1–10). Age starts at original command creation;
recapture and repeat requests cannot extend it. The required OriginalReplayGuard
port rechecks original initiator/approver rights, Pack admission, published
configuration, report and deployment/cohort fence using the supplied transaction.
Composition must supply this guard; no default permissive adapter exists.

Only FAILED/DEAD pre-invocation transport failures are eligible. Any prior invocation
requires reconciliation, including SAFE_RETRY commands. Invalidated authority,
conflicts, changed command/approval, expired approval/policy, revoked rights and
stale row versions cannot release the outbox. The existing command and outbox are
locked in dispatcher order, then requeued atomically with the immutable decision
and audit. The original payload, target, effect key and consumed approval survive.
A persisted dispatch deadline is the minimum of the original expiry and guard
proof window; the shared durable dispatcher checks it before its invocation hook.

Request-key uniqueness is scoped to the original command; exact duplicates return
the existing decision after current authority checks. A different body or actor
conflicts. Responses are allowlisted diagnostics; provider/database errors are
sanitized. Read/action responses use `private, no-store`.

The browser entry is `/pilot/dead-letters` or
`/workspaces/:workspaceId/projects/:projectId/pilot/dead-letters`. It uses the
same-origin session BFF, current CSRF and session expiry, clears data on scope or
identity change, disables expired/uncertain retries and retains the exact decision
request after an unconfirmed response. Production entry-point composition remains
part of T025; controlled HTTP/browser adapters prove this module locally.

## Gate bridge and order

GateRun describes an execution; existing ProjectOnboardingGateResult remains the
L0/C1/N2/P3 authority. Publish a gate result only against exact current subject
refs and verified report bytes. Its PASS requires every required execution PASS;
FAIL maps to FAIL, missing input/required skipped execution maps to BLOCKED_INPUT.
Never map SKIPPED_GATED to PASS. Existing immutable reports retain their history.

| Existing gate | Required evidence |
|---|---|
| L0 | 001–007 compatibility and all 008 engineering checks |
| C1 | Selected protocol/input metadata validation only |
| N2 | Real sandbox conformance, ingress and fault injection |
| P3 pre-activation | Current N2, security/scans, actual recovery, shadow review, cohort/window/on-call/rollback and baseline protocol readiness |

Limited-pilot observations and final review occur after activation; they are not
prerequisites of the first P3 activation. This avoids a circular requirement.
Numeric targets/minimum sample are approved after baseline, before comparison.
Platform production R4 is a separate scope and never product-production permission.

Local and corporate summaries remain separate. Required skipped checks cannot
become green. Stale/expired/mismatched evidence blocks new promotion.

## Shadow, activation and suspension

Shadow stores local observations/proposals but writes no Jira/GitLab/Mattermost
business effects. It cannot accept a draft as a Work Item; already accepted external
items may have read projections. Conformance writes use a separately scoped sandbox
run, never shadow permission. Shadow notifications are local sink records, not a
backlog released after activation.

Pin deployment/input/cohort/gates/bindings/current state in the existing activation
candidate's semantic snapshot. Consumption rechecks action identity, target/hash,
actor/approver/basis, expected state, expiry and idempotency. Dispatch rechecks
after queue delay. Cohort membership narrows entitlements and cannot grant roles.
Initial reference pilot proves all three connectors and one FULL_QA scenario.

Window expiry, revoked scope and suspension block new effects/retries. In-flight
results still reconcile; suspension cannot retract a sent remote request. A
confirmed guardrail breach stops expansion and opens incident review; close affected
write scope using existing suspension/fence controls. Resume needs exact approval
and current checks. Expansion publishes a new cohort/input revision and onboards
one Project at a time. Review never authorizes product release.

UI presents missing inputs/owners, stale health, failed checks, uncertainty,
replay reasons, evidence availability and measurement completeness as actionable
operator information.
