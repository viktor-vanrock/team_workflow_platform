# Quickstart validation: GitLab automated validation

**Feature:** `005-gitlab-automated-validation`

**Required local contour:** `qa-jira-gitlab-local`

**Purpose:** prove US-001…US-004 through the real API, worker, PostgreSQL,
Redis, Feature 003 Jira integration, GitLab Connector and the stateful GitLab
module in Mock Hub. The contour must remain fully local and must not require a
corporate VPN, real GitLab credentials or any production endpoint.

> **Implementation status:** the commands below are executable verification
> contracts. A missing command, undocumented scenario, stale child report or
> hand-edited `PASS` report fails `verify:005:quickstart` and the final gate.

See [data-model.md](data-model.md) for state ownership and invariants,
[contracts/](contracts/) for the versioned interface definitions, and
[research.md](research.md) for the provider and recovery decisions behind this
guide.

## 0. Blocking entry gates

Run from the repository root:

```bash
corepack pnpm verify:003:evidence

# Feature 005 fail-closed prerequisite and constitution gates
corepack pnpm verify:005:prerequisites
corepack pnpm verify:005:governance
corepack pnpm verify:005:setup
corepack pnpm verify:005:foundation
```

Expected:

- Feature 003 local Jira evidence is a current, task/source/runtime-bound
  `PASS`;
- optional live Jira evidence may remain `SKIPPED_GATED`, but is never
  relabelled as live `PASS`;
- Feature 005 pins the exact immutable upstream contracts and migration
  baseline it consumes;
- Feature 004 is not a blocking dependency for standalone GitLab implementation
  and conformance. The later pilot-release gate requires fresh Feature 004
  evidence and the combined Jira+GitLab+Mattermost composition;
- the Constitution 2.0.0 checks pass without an exception: technical Attempt
  outcome, Session Outcome and human QA Verdict remain distinct;
- no story implementation or live GitLab request starts when either planned
  Feature 005 entry gate fails.

## 1. Install and validate design contracts

```bash
corepack pnpm install --frozen-lockfile

# Offline schemas, examples and architecture boundaries
corepack pnpm test:contract:005
corepack pnpm test:architecture:005
```

Expected contract evidence:

- JSON Schema, OpenAPI 3.1 and AsyncAPI 3.0 documents parse with offline refs;
- positive examples validate and negative examples reject unknown fields,
  arbitrary variables, shell fragments, raw credentials, foreign Project IDs,
  production targets and deploy jobs;
- the GitLab Profile pins one numeric GitLab project, allowed refs, suites,
  non-production environments, typed inputs or variables, result schema and
  artifact policy;
- Suite Binding, Target Snapshot, Automation Attempt, normalized result,
  artifact metadata and webhook envelope contracts have explicit immutable
  versions;
- the Connector exposes only source-context read, pipeline trigger/status and
  CI-artifact read capabilities. CI configuration edit, repository push,
  protected-branch mutation, secret read, deployment and release decisions are
  absent;
- architecture checks reject GitLab imports from Platform Core, QA domain and
  UI code, reject QA persistence imports from the Connector, and reject dynamic
  runtime loading.

## 2. Start the required local contour

```bash
# Local GitLab contour lifecycle
corepack pnpm local:gitlab:up
corepack pnpm local:gitlab:status
corepack pnpm local:gitlab:migrate
corepack pnpm local:gitlab:seed
corepack pnpm gitlab:scenario -- setup-profile-discovery-dry-run
corepack pnpm gitlab:scenario -- setup-profile-deploy-denied
```

The status command must show:

- composition `qa-jira-gitlab-local`;
- API, worker, PostgreSQL, Redis, S3Mock, fake OIDC and Mock Hub healthy;
- stateful Jira and GitLab modules in Mock Hub;
- one synthetic Platform Project bound to one numeric mock GitLab project;
- one immutable validated GitLab Profile and Project Integration Binding. The
  foundation seed intentionally remains `MANUAL_ONLY` until an authorized
  HUMAN publishes a compatible Suite Binding; US-001 tests exercise that
  publication and immutable automated Session path;
- one allowlisted local build/commit, one non-production environment and
  deterministic test-data/account lease references;
- distinct project-scoped read/trigger and webhook signing references
  represented only by safe metadata/fingerprints, with exact
  operation-to-slot routing;
- local GitLab pilot metadata loaded from
  `config/local/gitlab-pilot-metadata.v1.json`;
- external network mode `deny`, no corporate endpoint or credential, and no
  production/deploy target.

Setup evidence must prove Profile validation calls project-scoped discovery and
CI Lint with exact ref, `dry_run=true` and job inclusion while trigger-call
count stays zero. A discovered production environment, deploy job/stage,
foreign project/ref, unrecognized identity routing or broad scope makes the
Profile/Connection validation report `INVALID` before any signing reference is
resolved or pipeline is triggered.

List the documented scenarios before running them:

```bash
corepack pnpm gitlab:scenario -- --list
```

Each scenario selection must be persisted in Mock Hub PostgreSQL so a worker or
Mock Hub restart cannot silently erase an unconsumed fault.

## 3. US-001 — create an automated Session safely

```bash
corepack pnpm gitlab:scenario -- us1-automated-session
corepack pnpm gitlab:scenario -- us1-suite-denied
corepack pnpm gitlab:scenario -- us1-environment-denied
corepack pnpm gitlab:scenario -- us1-manual-only
corepack pnpm gitlab:scenario -- us1-target-change-linked-session
corepack pnpm verify:005:us1
```

Evidence must prove:

1. An authorized QA Executor selects only registered Suite Binding, immutable
   build/commit and allowlisted non-production environment values.
2. Confirming the plan creates one `AUTOMATED` Test Session with exact immutable
   Target and Scope snapshots, including Suite Binding, Project Integration
   Binding and Profile refs/hashes actually used.
3. A disallowed suite, ref, environment, target type, input or variable is
   rejected before Connector invocation; Mock Hub trigger-call count remains
   zero.
4. A `MANUAL_ONLY` Project returns an explicit capability-unavailable result,
   while creation and execution of a manual Session remain available.
5. Actor, Workspace/Project scope, authorization basis, request key,
   correlation/causation IDs and pinned configuration appear in durable audit;
   raw secrets and arbitrary provider values do not.
6. A pre-start target change creates a new immutable snapshot/revision. A
   post-start target change cannot mutate history and instead creates one
   same-scope linked Session with reason `TARGET_CHANGED` and the prior target
   hash.

## 4. US-002 — exactly-one pipeline trigger

```bash
corepack pnpm gitlab:scenario -- us2-trigger-once
corepack pnpm gitlab:scenario -- us2-command-replay
corepack pnpm gitlab:scenario -- us2-stale-confirmation
corepack pnpm gitlab:scenario -- us2-mismatched-confirmation
corepack pnpm gitlab:scenario -- us2-timeout-after-trigger
corepack pnpm gitlab:scenario -- us2-lookup-zero
corepack pnpm gitlab:scenario -- us2-lookup-multiple
corepack pnpm verify:005:us2
```

Evidence must prove:

1. Launch requires an exact HUMAN echo of the server-issued target, Suite,
   configuration-pin-set and action hashes plus the current `If-Match`
   resource version. A stale version or mismatched commitment is denied before
   command persistence and before Connector invocation; an accepted launch
   durably records confirmation hash, confirmed Session version, actor and
   authorization basis. It creates no Approval aggregate or second approval
   request: confirmation itself is the accountable HUMAN command action.
2. The API deduplicates `testSessionId + requestKey`; same key and same canonical
   request returns the original command/Attempt/pipeline, while the same key
   with a different request hash is rejected.
3. The adapter sends only the exact Profile-selected ref and allowlisted typed
   inputs/variables. It never accepts a job name, shell fragment, token, URL or
   arbitrary environment value from the client.
4. The first accepted trigger records one immutable Attempt and one external
   pipeline ID. Replayed API/worker deliveries keep the same platform effect
   identity and Mock Hub provider effect count remains exactly one.
5. A timeout after possible provider acceptance never causes a blind second
   POST. Reconciliation uses the pinned request marker/pipeline-name contract;
   exactly one match confirms the original pipeline.
6. Lookup zero/multiple after the bounded consistency window leaves the Attempt
   visibly `INCOMPLETE`/ambiguous for manual recovery. It does not invent a
   pipeline and does not trigger again.
7. A later technical retry is a new immutable Attempt and pipeline with a new
   effect identity; it never calls GitLab's retry-pipeline operation.

## 5. US-003 — technical result, bounded retry and human review

```bash
corepack pnpm gitlab:scenario -- us3-pass-review-required
corepack pnpm gitlab:scenario -- us3-assertion-failed-no-auto-retry
corepack pnpm gitlab:scenario -- us3-allowlisted-infra-retry
corepack pnpm gitlab:scenario -- us3-unknown-infra-no-retry
corepack pnpm gitlab:scenario -- us3-explicit-rerun-pass-flaky
corepack pnpm gitlab:scenario -- us3-result-schema-drift
corepack pnpm gitlab:scenario -- us3-artifact-checksum-mismatch
corepack pnpm gitlab:scenario -- us3-quarantine-lifecycle
corepack pnpm gitlab:scenario -- us3-review-packet-proposal-only
corepack pnpm gitlab:scenario -- us3-post-review-linked-session
corepack pnpm verify:005:us3
```

Evidence must prove:

- normalized Attempt outcomes are only `PASS | ASSERTION_FAILED | INFRA_FAILED
  | TIMEOUT | CANCELLED | INCOMPLETE`;
- a terminal provider pipeline is not accepted from webhook payload alone: the
  worker performs an authoritative project-scoped read and validates the exact
  pinned machine-result schema;
- assertion failure creates no automatic retry and moves the Session toward
  human review;
- only the exact QA-owned, Suite-pinned retry policy may authorize one retry for
  a Connector-normalized `(outcome, infrastructureCode)`. Unknown/policy errors,
  401/403 and a second infra failure create no additional automatic Attempt;
- every retry appends an immutable Attempt with contiguous lineage; no prior
  pipeline, result or artifact membership is overwritten;
- assertion failure followed by PASS remains `FLAKY_SUSPECTED` until an
  authorized human records a disposition; a purely allowlisted infrastructure
  recovery preserves its full lineage without becoming product flakiness
  automatically;
- unknown/missing/drifted result schema and checksum mismatch become
  `INCOMPLETE`/manual review, never PASS;
- artifact metadata pins project, pipeline/job, provenance, checksum,
  classification and retention. Raw artifact content is not sent to Hermes or
  another model automatically;
- the first terminal pipeline makes `REVIEW_REQUIRED` sticky; an automatic
  retry or explicit rerun may execute while the Session remains in that state,
  and completion stays blocked while any retry or reconciliation is pending;
- quarantine activation records exact Suite-version or infrastructure-code
  subject, accountable owner, bounded reason, evidence, policy and expiry.
  Lift/clock-expiry preserves the original failure and full revision history;
  active quarantine blocks only policy-defined retry/launch behavior;
- when Feature 004 is installed, Hermes receives only authorized summaries and
  creates the exact schema-bound review packet/Finding drafts with current
  `attemptSetHash`, evidence refs, exact quarantine warning revisions and
  `proposalOnly=true`; it receives no raw
  artifact bytes and performs no Finding classification, Session transition,
  Outcome/Verdict signature or pipeline action. Without Feature 004 this
  optional scenario is `SKIPPED_GATED` and the core QA review flow still passes;
- after a human Plan Item Result or Session review freezes the Attempt set,
  further validation cannot append an Attempt and instead creates a linked
  same-target Session with reason `REVIEW_FROZEN`;
- technical PASS never signs Session Outcome, QA Verdict or release decision.

The authorized QA Executor must review canonical Attempt Results, classify
Findings with the existing `PRODUCT | INFRA | INCONCLUSIVE | DUPLICATE |
ACCEPTED_RISK` taxonomy, resolve any `FLAKY_SUSPECTED` flag, and explicitly sign
the Session Outcome. High/critical/waiver cases continue to use the risk-based
reviewer policy.

## 6. US-004 — outage and reconciliation

```bash
corepack pnpm gitlab:scenario -- us4-lost-webhook-reconciliation
corepack pnpm gitlab:scenario -- us4-duplicate-webhook
corepack pnpm gitlab:scenario -- us4-out-of-order-webhook
corepack pnpm gitlab:scenario -- us4-gitlab-outage-manual-flow
corepack pnpm gitlab:scenario -- us4-auth-revoked
corepack pnpm gitlab:scenario -- us4-rate-limit-recovery
corepack pnpm verify:005:us4
```

Evidence must prove:

- webhook raw bytes pass the exact pinned Standard Webhooks HMAC-SHA256
  dialect, replay window, delivery dedupe and numeric project scope checks
  before durable processing;
- duplicate delivery has one receipt/effect; the same delivery ID with changed
  body is quarantined; out-of-order pipeline/job signals never roll state back;
- a webhook is only a hint. Authoritative polling/reconciliation restores a
  lost terminal event and preserves monotonic Attempt state;
- GitLab outage keeps automated work pending/error with visible freshness and
  Connection health, while Jira work and manual Test Sessions continue;
- 401/403 stop retries and degrade Connection health with a closed reason;
- status/artifact reads handle 429/5xx with bounded Profile backoff. An
  ambiguous trigger write still follows lookup-only rules from US-002;
- worker, Redis or Mock Hub restart preserves commands, Attempt lineage,
  provider state, inbox/outbox and reconciliation cursors;
- recovery cannot close the Jira Work Item or sign a QA Verdict automatically.

## 7. Security, isolation and production denial

```bash
corepack pnpm test:integration:005
corepack pnpm test:security:005
```

Required negative evidence:

- missing/revoked Workspace membership, Project Entitlement, QA permission,
  data-classification access, Tool Grant or active Binding/Profile;
- foreign Workspace/Project/session/Suite/Profile/Connection substitutions;
- webhook with wrong numeric GitLab project, invalid signature, stale
  timestamp, replay, same delivery ID with changed body or oversized payload;
- cross-project pipeline/job/artifact IDs and raw GitLab URLs;
- arbitrary ref, suite, environment, input/variable name or value, shell
  fragment, job selector and artifact path traversal;
- embedded token/secret, credential alias across Projects and secret material
  in logs, audit, command payload or report;
- artifact classification/retention/access bypass, checksum mismatch and
  expired raw content;
- automatic retry for assertion/unknown/policy/auth failures or more than one
  automatic infra retry;
- any non-HUMAN, autonomous, webhook/event-driven or scheduled initial launch,
  and any unregistered/large-regression Suite request. Each is denied before
  command creation and provider access; V1 admits only the registered bounded
  human-selected smoke Suite;
- any attempt by Hermes, service identity or webhook to sign Session Outcome,
  QA Verdict or release decision;
- production environment, production-looking endpoint, protected/deploy ref,
  deployment job or CI configuration mutation.

Production denial must happen before credential materialization and before any
adapter/network call. The provider call audit must remain zero. Tests must prove
all five controls independently: project identity permissions, GitLab pipeline
policy, platform Profile/Binding allowlists, platform effect/runtime policy and
network/egress policy.

## 8. PostgreSQL 17/18 and recovery matrix

```bash
corepack pnpm verify:005:migrations -- postgres=17
corepack pnpm verify:005:migrations -- postgres=18
```

Both PostgreSQL versions must pass:

- fresh installation and current repository baseline to Feature 005 upgrade;
- repeat migration with no duplicate mutation;
- failed migration recovery without partial schema publication;
- same-scope composite foreign keys for Session, Attempt, pipeline/job and
  artifact references;
- append-only/immutable Attempt and result guards;
- contiguous attempt numbering and one automatic retry budget under
  concurrency;
- one winner for concurrent launch/replay/webhook/polling claims;
- crash before provider invocation, timeout after possible effect, worker
  restart and lost Redis recovery;
- artifact expiry changes availability while preserving metadata, checksum and
  audit lineage.

## 8.5. Observability and deterministic SLO checks

```bash
corepack pnpm verify:005:observability
```

With an injected virtual clock and deterministic load, evidence must prove:

- accepted launch acknowledgement p95 is at most 2 seconds;
- a valid webhook becomes visible in the platform within 30 seconds;
- a lost webhook is repaired within 120 seconds and no more than two scheduled
  polls;
- terminal status to artifact metadata availability is at most 120 seconds;
- metric dimensions use bounded enums only; Workspace/Project/Session/Attempt
  IDs, commit SHA, request keys and untrusted provider text never become labels;
- logs/traces redact credentials, raw typed inputs, webhook bodies and
  restricted artifact content;
- duplicate-effect, blind-retrigger, automated-verdict and production-call
  safety counters remain zero.

## 9. Browser and full-process acceptance

```bash
corepack pnpm test:e2e:005
corepack pnpm smoke:005
corepack pnpm trace:005
corepack pnpm verify:005:quickstart
corepack pnpm verify:005
corepack pnpm verify:005:evidence
corepack pnpm ci:005
```

`smoke:005` must launch real child processes and isolated local compose project
names, execute every documented GitLab scenario, inspect both platform and Mock
Hub PostgreSQL state, restart worker/Mock Hub during durable work, exercise the
browser journey and shut down cleanly.

`trace:005` must map every `FR-001…FR-025` and `SC-001…SC-007` to executable,
fresh evidence. `verify:005:quickstart` must reject missing/orphaned commands,
undocumented scenarios, stale smoke reports and any unexecuted success
criterion. The aggregate gate must run prerequisite/governance, contract,
architecture, integration, security, deterministic observability/SLO, E2E,
PostgreSQL 17/18, process smoke, OpenAPI/schema drift, typecheck, lint, build,
non-prod metadata, traceability and task/source/runtime-bound evidence stages.

Expected report set:

```text
reports/005-gitlab-automated-validation/
├── prerequisites.json
├── governance.json
├── setup-gate.json
├── foundation.json
├── us1.json
├── us2.json
├── us3.json
├── us4.json
├── migrations.json
├── observability.json
├── documented-scenarios.json
├── smoke.json
├── quickstart.json
├── nonprod-metadata.json
├── nonprod.json
├── traceability.json
├── evidence.json
└── final-gate.json
```

`pilot-rehearsal.json` and `pilot-release.json` are produced only by the
separate gates in section 10.1, validate against
`urn:awp:schemas:005:gitlab-pilot-gate-evidence:v1` and are never implied by
`final-gate.json`.

Expected final local result:

```text
status: PASS
contour: qa-jira-gitlab-local
local: PASS
liveGitLab: SKIPPED_GATED | PASS
mattermostCompatibility: NOT_REQUESTED | PASS
deploymentApproval: LOCAL_CONFORMANCE_ONLY
pilotRelease: NOT_REQUESTED
production: DENIED
productionRunsSupported: false
```

A final `PASS` is valid only when `verify:005:evidence` confirms that task,
source, contract, runtime and child-report hashes still match the bound handoff.

## 10. Optional live non-production GitLab validation

```bash
# Explicit opt-in; never part of the mandatory local PASS
AWP_LIVE_GITLAB_OPT_IN=true \
  corepack pnpm verify:005:nonprod \
  --metadata config/gitlab-pilot-metadata.json
```

Before any network call the verifier must validate an immutable
`GitLabPilotMetadataPackage@1.0.0` that pins:

- one exact Workspace/Project and numeric GitLab project;
- GitLab base URL, exact version/build and API capability evidence;
- project-scoped read/trigger identities and webhook signing key by exact
  `secretref://` refs and safe fingerprints, with owner, scope/key version,
  rotation, revocation, least-privilege and separation/routing evidence;
- source MR/commit contract, trigger endpoint/ref, pipeline-name/idempotency
  marker contract, Suite Bindings and input/variable allowlists;
- non-production environments and runner/network/container readiness;
- machine-result schema, result job/artifact path, checksum source,
  classification, retention and access policy;
- webhook verification/replay/dedupe contract, reconciliation/rate budgets and
  Connector pre-effect transport-retry bounds;
- exact QA-owned retry policy ref/hash and closed infra retry codes with
  `maxAutomaticRetries = 1`;
- CI configuration/no-deploy evidence, operator opt-in and
  `productionDenied = true`.

Missing metadata, opt-in, credentials or allowed network access returns
`SKIPPED_GATED`; it is never reported as live `PASS`. A production environment,
endpoint, ref, suite or deploy job is a hard failure before secret resolution
or network access. Live validation may use only a dedicated non-production
project/suite and stores sanitized evidence hashes/reports, not credentials or
raw restricted artifacts.

### 10.1. Pilot rehearsal and mandatory deployment release gate

```bash
# Local combined rehearsal; cannot approve deployment
corepack pnpm verify:005:pilot-rehearsal \
  --metadata config/gitlab-pilot-rehearsal-metadata.json

# Required before a pilot deployment; never implied by local PASS
corepack pnpm verify:005:pilot-release \
  --metadata config/gitlab-pilot-metadata.json
```

The rehearsal requires `deploymentPurpose=PILOT_REHEARSAL`, the combined local
key and immutable refs/hashes for fresh Feature 003/004/005 plus Mattermost
composition evidence; it can emit only `PILOT_REHEARSAL_ONLY`. The deployment
gate requires `deploymentPurpose=PILOT_DEPLOYMENT`, combined DEVELOPMENT or
TEST HTTPS metadata, the same immutable evidence bindings and an immutable
ref/hash for a successful rehearsal receipt validated against
`urn:awp:schemas:005:gitlab-pilot-gate-evidence:v1` with
`gateKind=PILOT_REHEARSAL`. The gate resolves every ref, recomputes each hash
and rejects stale, mismatched, non-`PASS` or wrong-contour evidence before it
can emit approval. Both prove a
Mattermost outage leaves Jira/QA processing active and delivery pending in the
durable outbox. A `CONFORMANCE_VALIDATION` package, any standalone contour or
local Mock Hub is rejected as pilot-deployment evidence.

Expected local rehearsal result:

```text
status: PASS
deploymentApproval: PILOT_REHEARSAL_ONLY
contour: qa-jira-gitlab-mattermost-local
production: DENIED
```

Expected pilot-release result:

```text
status: PASS
deploymentApproval: PILOT_APPROVED
contour: qa-jira-gitlab-mattermost-development | qa-jira-gitlab-mattermost-test
feature003Evidence: PASS
feature004Evidence: PASS
feature005Evidence: PASS
mattermostOutageDegradation: PASS
production: DENIED
```

## 11. Cleanup

```bash
corepack pnpm gitlab:scenario -- reset
corepack pnpm local:gitlab:down
```

Use reset only when local fixture data may be discarded:

```bash
# Destructive only for the exact local compose project; exact confirmation is mandatory
corepack pnpm local:gitlab:reset -- --yes
```

The reset command must refuse every non-local contour, require its built-in
exact confirmation policy, and print the exact compose project and named
volumes it removes.

## 12. Troubleshooting

Inspect process status and bounded logs without changing state:

```bash
corepack pnpm local:gitlab:status

# Existing generic local command
corepack pnpm local:logs -- api worker mock-hub
```

Common failure interpretation:

| Symptom | Required interpretation/action |
|---|---|
| A planned `005` script is missing | Feature 005 implementation is incomplete; do not claim PASS. |
| `verify:003:evidence` fails | Upstream Jira/runtime evidence drifted; regenerate the upstream bound handoff before continuing. |
| Trigger replay creates two provider pipelines | Exactly-once invariant failed; inspect command/effect key and provider trigger-call audit. |
| Attempt remains ambiguous after timeout | Keep it `INCOMPLETE`/pending manual recovery; never rerun the same provider POST blindly. |
| Webhook is accepted but state does not advance | Inspect authoritative read/outbox and reconciliation cursor; never trust webhook fields as canonical result. |
| Result schema/checksum fails | Keep `INCOMPLETE`, preserve artifacts/diagnostics and require human review; never coerce to PASS. |
| GitLab is unavailable | Automated work may wait/error, but Jira and manual Session flows must remain healthy. |
| 401/403 repeats | Stop retry, mark Connection degraded/unavailable and validate identity scope/rotation. |
| 429/5xx repeats on reads | Apply the pinned bounded backoff/rate budget, then surface degraded freshness. |
| Production/deploy fixture reaches Mock Hub | Production boundary failed because denial was not pre-adapter; the gate must fail. |
| Final report was previously PASS but evidence verifier now fails | Source/task/contract/runtime/report drift invalidated the handoff; rerun the complete gate. |

To print the planned aggregate sequence without executing it, the implemented
gate should support:

```bash
corepack pnpm verify:005 -- --plan
```

Do not work around a failed gate by editing generated evidence JSON. Reports
must be produced atomically by their owning verification commands.
