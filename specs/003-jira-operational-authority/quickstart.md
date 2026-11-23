# Quickstart: Jira operational authority

**Feature:** `003-jira-operational-authority`  
**Purpose:** runnable validation contract for local protocol-mock and gated real non-prod Jira  
**Status:** implemented; deterministic local validation is runnable, while real non-prod Jira remains explicitly gated by a supplied pilot metadata package and operator opt-in

## 1. What this guide proves

The quickstart validates, end to end:

- one confirmed feature-002 Draft creates one central Jira QA Request and one Work Item/binding;
- a correct issue created directly by a verified Jira human imports once and runs completeness;
- human Jira changes update a monotonic projection with explicit freshness;
- stale transition/assignment/priority/due intent becomes a visible conflict and does not write from a known-stale state;
- one approved DefectDraft creates one linked defect;
- duplicate, crash, webhook replay/order gap, Jira outage, rate limit, auth failure and mapping drift are recoverable or safely terminal;
- audit reconstructs human → approval/command → exact integration chain → Jira call/sub-effects → authoritative confirmation.

It does not validate production Jira, release decisions, Jira administration, Mattermost, GitLab automated Sessions, SLA/queue or project onboarding.

## 2. Prerequisites

### 2.1. Toolchain

Required:

```text
Node.js 24.x (repository target: 24.20.0)
pnpm 11.21.0
Docker-compatible container runtime with Testcontainers support
PostgreSQL 17/18 images available
Chromium dependencies for Playwright
```

From the repository root:

```bash
node --version
pnpm --version
pnpm prerequisites
```

Expected: Node reports `v24.*`, pnpm reports `11.21.0`, and the prerequisite command passes. PostgreSQL migration checks additionally require a working Docker-compatible runtime.

### 2.2. Feature gates

```bash
pnpm verify:001
pnpm verify:002
pnpm verify:003:prerequisites
```

Expected:

- final machine-readable 001 and 002 reports exist and validate;
- `smoke:001` and `smoke:002` evidence is green;
- `competency-qa@1.0.0`, `operational-work-item@1.0.0`, generic confirmed-effect/import hooks, exact approvals and runnable worker composition are present;
- the gate does not accept planning documents as implementation evidence.

If this gate fails, do not create replacement 001/002 primitives in feature 003.

## 3. Local topology

Target composition:

```text
Browser             http://127.0.0.1:5173
Platform API        http://127.0.0.1:3000
Platform worker     internal BullMQ consumers + PostgreSQL sweepers
Fake OIDC           http://127.0.0.1:3002
Mock Hub Jira       http://127.0.0.1:3010
PostgreSQL          local container; platform and Mock Hub use separate DB/roles
Redis               local container; delivery only, never authoritative
```

The same `@awp/connector-jira` implementation calls Mock Hub Jira through Cloud-v3 or DC-v2 protocol dialects. The local composition does not replace it with an in-process fake port.

Start and initialize:

```bash
pnpm local:jira:up
pnpm local:jira:migrate
pnpm local:jira:seed
pnpm local:jira:status
```

Expected:

- composition is exactly `qa-jira-local`;
- Connection environment is `LOCAL` and endpoint is Mock Hub only;
- central/source/defect Profiles are published from deterministic discovery snapshots;
- no corporate endpoint, non-local secret or production egress is present;
- PostgreSQL migrations include completed Core 0090/0095, Jira persistence contribution 3000…3020 and Mock Hub Jira chain.

## 4. Seeded identities and scopes

The deterministic seed provides at least:

| Principal | Platform role/scope | Jira identity |
|---|---|---|
| `requester.alpha` | HUMAN Requester, Workspace ALPHA / Project APP | verified Cloud account fixture |
| `executor.alpha` | HUMAN QA Executor, ALPHA / APP | verified Cloud account fixture |
| `lead.alpha` | HUMAN QA Lead, ALPHA / APP | verified Cloud account fixture |
| `requester.beta` | HUMAN Requester, ALPHA / Project BETA only | different verified Jira fixture |
| `outsider.delta` | HUMAN in another Workspace | no ALPHA entitlement |
| `jira.service.local` | SERVICE Connector runtime | least-privilege local credential ref |

Jira fixture topology:

```text
Central project:   QAC / issue type QA Request
Source project:    APP / issue type Story|Bug
Defect project:    APP / issue type Bug
Project discriminator field: customfield_10010
Effect marker field:          customfield_10011
```

Names are local fixtures only; implementation never treats them as pilot defaults.

## 5. Stable verification entrypoints

```bash
pnpm test:contract:003
pnpm test:integration:003
pnpm test:e2e:003
pnpm smoke:003
pnpm trace:003
pnpm verify:003
```

Focused checkpoints:

```bash
pnpm verify:003:foundation
pnpm verify:003:us1
pnpm verify:003:us2
pnpm verify:003:us3
pnpm verify:003:us4
```

Each checkpoint emits a machine-readable report under `reports/003-jira-operational-authority/` with exact command, environment, contract/profile refs, effect counts and correlation trace. Reports contain hashes and sanitized IDs, not credentials or unrestricted Jira payloads.

## 6. Configuration lifecycle validation

Run:

```bash
pnpm jira:scenario profile-lifecycle
```

Expected sequence:

1. create local Connection draft with adapter `jira-cloud-v3@1.x` and opaque local secret ref;
2. discover server/projects/issue types/fields/statuses/transitions/priorities/link types/capabilities;
3. store immutable sanitized discovery snapshot;
4. validate bounded Mapping and central/source/defect Profile candidates;
5. preview deterministic mapped create/defect requests;
6. dry run performs only metadata/permission/JQL reads and reports zero Jira writes;
7. publish immutable Profile/Binding versions;
8. attempted in-place update is rejected; changed mapping creates version `n+1`;
9. unknown field/status/link, arbitrary JQL, `eval`-like expression, missing discriminator/marker or production endpoint blocks only the affected candidate.

Evidence:

- discovery/profile content hashes round-trip;
- no raw secret/provider body in DB/log/audit;
- source, central and defect roles resolve independently;
- pairwise import scopes for the central project are non-overlapping;
- 1.0 operational Profile fixtures remain valid.

## 7. US1 — central QA Request creation

### 7.1. Happy path

```bash
pnpm jira:scenario us1-create
```

Expected:

- unconfirmed Draft has zero Jira effects and no Work Item;
- explicit confirmation pins exact Draft version and Project Binding;
- one durable `request.create` command and effect key are stored;
- Connector marker lookup finds no issue, creates one QAC QA Request and required APP source link;
- authoritative read returns immutable issue ID, display key, revision token, raw/mapped status and requester;
- one transaction creates Work Item, operational binding/current projection, QA extension/initial input and audit/event;
- UI shows Jira key/raw+normalized status/freshness; requested/pending state disappears after confirmation.

Count assertions:

```text
Drafts linked:                 1
Jira QA Request issues:        1
Jira source links:             1
Work Items:                    1
Operational bindings:         1
Current projection revisions: 1+
QA request extensions:         1
Create effect keys:            1
```

### 7.2. Duplicate and crash recovery

```bash
pnpm jira:scenario us1-duplicate-submit
pnpm jira:scenario us1-timeout-after-create
pnpm jira:scenario us1-timeout-after-source-link
pnpm jira:scenario us1-worker-restart
pnpm jira:scenario us1-redis-loss
```

Expected in every case:

- same client key/hash returns the original command/result;
- concurrent confirmation serializes on Draft/idempotency identity;
- possibly started create performs marker lookup before retry;
- existing exact issue/link is reconciled, not recreated;
- Work Item/binding/QA extension appears only after final authoritative confirmation;
- Redis loss is repaired from PostgreSQL;
- final issue/link/Work Item/effect counts remain one.

### 7.3. Jira outage and ambiguity

```bash
pnpm jira:scenario us1-jira-unavailable
pnpm jira:scenario us1-marker-search-ambiguous
```

Expected:

- Draft and durable command remain visible;
- no fake Work Item or confirmed Jira status is created;
- bounded retry follows 429/5xx policy;
- uncertain possibly-started create becomes `AMBIGUOUS` and automatic create retry stops;
- operator diagnostic exposes safe candidate IDs/hashes only;
- resolution cannot change original command payload/target/approval.

## 8. US2 — direct Jira import

### 8.1. Verified human import

```bash
pnpm jira:scenario us2-direct-import
```

Mock Hub creates an in-scope QAC QA Request as `requester.alpha`, with the APP discriminator and required structural fields.

Expected:

- webhook is durably accepted and ACKed without a synchronous Jira GET;
- worker re-reads the issue, validates exact type/import JQL/Profile/discriminator;
- external creator resolves through one VERIFIED binding to an active HUMAN;
- membership/Project Entitlement/role/classification is rechecked;
- one `OperationalImportIntent` reaches `ADOPTED`;
- one Work Item/binding/projection and one QA extension/initial input are created atomically;
- feature-002 completeness executes; missing semantic facts yield QA `NEEDS_INFO` without changing Jira status;
- webhook retry and import reconciliation return the same Work Item.

### 8.2. Safe negative routing

```bash
pnpm jira:scenario us2-unverified-creator
pnpm jira:scenario us2-missing-discriminator
pnpm jira:scenario us2-ambiguous-discriminator
pnpm jira:scenario us2-out-of-scope-issue
pnpm jira:scenario us2-cross-project-substitution
```

Expected:

- no Work Item, binding or QA extension;
- states are `AWAITING_CONFIRMATION`, `BLOCKED_MAPPING`, `IGNORED_OUT_OF_SCOPE` or `REJECTED_SECURITY` as defined;
- unauthorized users receive 404/deny without external key/title/body disclosure;
- Workspace-scoped security audit contains reason/hash only;
- strict import failure does not broaden JQL or try another Profile.

### 8.3. Create/import race

```bash
pnpm jira:scenario us2-create-import-race
```

Expected: create confirmation, webhook and reconciliation converge on the same Connection/external issue authority key and produce exactly one Work Item/binding.

## 9. US3 — synchronization and conflicts

### 9.1. Human Jira change

```bash
pnpm jira:scenario us3-human-change
```

Mock Hub changes status, assignee, priority and due date as a Jira human and emits a webhook.

Expected:

- webhook payload itself changes no projection;
- authoritative read creates one append-only projection revision;
- Work Item derived normalized status/assignee matches current projection in the same transaction;
- UI shows raw Jira status, normalized status, source `WEBHOOK_READ`, provider updated time, observed time and fresh-until;
- audit identifies external observation, not a fabricated platform human action.

### 9.2. Duplicate, out-of-order and lost webhook

```bash
pnpm jira:scenario us3-duplicate-webhook
pnpm jira:scenario us3-out-of-order-webhook
pnpm jira:scenario us3-lost-webhook-reconciliation
pnpm jira:scenario us3-same-token-different-hash
```

Expected:

- same delivery/hash is duplicate;
- same delivery/different hash is security conflict;
- older read cannot roll back projection;
- incomparable/gap schedules reconciliation without canonical mutation;
- lost event is repaired by `BOUND_REFRESH`/full sweep;
- durable watermark advances only after complete successful traversal.

### 9.3. Exact approved transition/assignment/priority/due

```bash
pnpm jira:scenario us3-transition
pnpm jira:scenario us3-assignment
pnpm jira:scenario us3-priority
pnpm jira:scenario us3-due-date
```

For each action:

- HUMAN prepares a closed provider-neutral intent from the current projection;
- command/Approval pin full typed payload, target, expected revision/value and exact chain;
- another authorized HUMAN approves according to policy;
- effect-time access/config/expiry recheck passes;
- Connector fresh-reads, compares token/value, writes minimum field/effect and post-reads;
- confirmed projection changes only after the post-read;
- replay returns the same effect/receipt.

The request body never contains Jira transition/field/account ID. Assignment uses canonical principal ID resolved through verified binding.

### 9.4. Stale conflict and drift

```bash
pnpm jira:scenario us3-stale-command
pnpm jira:scenario us3-profile-drift-before-effect
pnpm jira:scenario us3-permission-revoked
pnpm jira:scenario us3-mapping-drift
pnpm jira:scenario us3-post-read-mismatch
```

Expected:

- known stale pre-read returns `CONFLICT` and performs zero Jira mutation;
- newest Jira read may update projection while an append-only conflict remains visible;
- old Approval cannot resume; new human decision creates new command/approval;
- profile/access/expiry drift invalidates authorization before Connector invocation;
- missing field/status/transition marks only affected Profile/binding `MAPPING_REQUIRED`;
- post-read mismatch is conflict/ambiguity, never silent success;
- last good projection remains visible with freshness state.

## 10. US4 — approved defect publication

### 10.1. Happy path and replay

```bash
pnpm jira:scenario us4-defect
pnpm jira:scenario us4-defect-replay
```

Prerequisite fixture includes a feature-002 completed/reviewed Session, classified PRODUCT Finding, immutable DefectDraft, signed evidence manifest and exact human approval.

Expected:

- `DEFECT_DESTINATION` resolves independently from central/source Profiles;
- payload contains only allowlisted mapped fields and safe Session/build/evidence refs;
- exact effect marker lookup precedes create;
- one APP defect is created and linked to the QAC request with the pinned link type/direction;
- authoritative read confirms external ID/key/revision and required link;
- generic confirmation UoW invokes the QA hook and writes one DefectLink;
- repeated approval/callback/recovery creates no second defect or link.

### 10.2. Partial and negative cases

```bash
pnpm jira:scenario us4-timeout-after-defect
pnpm jira:scenario us4-timeout-after-link
pnpm jira:scenario us4-duplicate-candidates
pnpm jira:scenario us4-profile-drift
pnpm jira:scenario us4-wrong-project
```

Expected:

- timeout recovery finds exact marker and completes only missing link;
- heuristic similar issues are candidates for human decision and never auto-confirm the effect;
- payload/profile/expected-state/access drift invalidates approval with zero new effect;
- result from another project/Profile/Connection is rejected before QA confirmation;
- DefectDraft/DefectLink history remains immutable and scoped.

## 11. Error and rate-limit matrix

```bash
pnpm jira:scenario failures
```

Expected table:

| Provider condition | Normalized result | Retry behavior |
|---|---|---|
| 401 | `AUTHENTICATION` | stop, Connection `AUTH_BLOCKED`, alert |
| 403 | `PERMISSION` | stop, scoped security/integration alert |
| 409/known token mismatch | `CONFLICT` | no retry; new decision required |
| 429 | `RATE_LIMIT` | honor Retry-After + bounded jitter; commands outrank sweep |
| 5xx | `TRANSIENT` | bounded backoff; write reconciles before retry |
| timeout before effect | `TRANSIENT` | safe retry under same effect key |
| timeout after possible effect | `AMBIGUOUS`/lookup | no blind write retry |
| invalid/missing Jira field/status | `MAPPING_DRIFT` | affected Profile only blocked |
| missing issue | `NOT_FOUND` | alert/tombstone policy; never create replacement |
| wrong project/profile | `SECURITY_SCOPE` | terminal reject before disclosure/effect |

## 12. Isolation, least privilege and redaction

```bash
pnpm jira:scenario security-matrix
```

Must prove:

- same Workspace/different Project, different Workspace and insufficient classification are denied before repository detail/Jira call;
- Profile/JQL/link membership never grants Platform Project access;
- service identity cannot Delete Issues, administer Jira/project/workflow/fields/users or access unbound project;
- runtime uses an opaque secret ref and no personal PAT/impersonation;
- webhook of another Connection/project/type cannot create a project event;
- logs, problem details, OTel, audit, events and browser payloads contain no raw token, raw provider body, restricted issue text, secret ref value or artifact locator;
- production endpoint/environment/credential/network route is rejected.

## 13. Freshness and reconciliation budget

```bash
pnpm jira:scenario freshness
pnpm jira:scenario cloud-pagination
pnpm jira:scenario dc-pagination
```

Expected:

- freshness derives from the exact Profile target and confirmed observation time;
- expiry changes header freshness to STALE without inventing a projection revision;
- webhook confirmation and command read-back lanes have priority over sweep;
- Cloud `nextPageToken` and DC offset are transient run state;
- durable cursor is `(updated,key)` with overlap;
- concurrent Jira updates during pagination do not skip immutable issue IDs after overlap/full sweep;
- a partial run does not advance the safe watermark;
- 429 budget is per Connection and visible in sanitized metrics/report.

## 14. Audit trace

```bash
pnpm trace:003 --scenario us4-defect
```

Expected trace chain:

```text
verified human intent
  → initial authorization basis
  → exact typed command and payload/target hashes
  → exact Approval subject/decision/effect authorization
  → effect-time authorization basis
  → exact Binding/Profile/Mapping/Connection/adapter refs
  → Jira transport attempt and sub-effect receipt hashes
  → authoritative read observation/projection revision
  → generic confirmation + QA hook event
```

Correlation and causation IDs remain stable across API, outbox, worker, Connector, webhook/reconciliation and confirmation.

## 15. Optional real non-prod validation

This section is not part of local critical CI.

Required before execution:

- schema-valid `JiraPilotMetadataPackage@1` with named owners;
- separate non-prod Connection and non-human service identity;
- approved secret provider/ref and rotation/revoke test;
- TLS/network reachability;
- exact central/source/defect projects and safe cleanup policy;
- discovery/permission evidence and published Profiles/Binding;
- webhook registration/verification evidence;
- selected concurrency mode and required safety/risk review;
- rate/freshness budget.

Run:

```bash
pnpm jira:nonprod:preflight
pnpm jira:nonprod:contract
pnpm jira:nonprod:least-privilege
```

Expected:

- missing input reports `SKIPPED_GATED`, never pass;
- dry-run performs no writes;
- controlled create/read/link/transition/read-back/defect flow uses only dedicated non-prod fixtures;
- least-privilege negative operations fail;
- exact marker lookup, webhook identifiers/HMAC, rate headers and concurrency mode are recorded as sanitized evidence;
- no production URL/credential/action is possible.

If strict atomic no-overwrite is required, `COMPARE_AND_VERIFY` must fail preflight; a reviewed `JIRA_SIDE_CAS` adapter endpoint is required.

## 16. Final acceptance gate

Run from a clean state:

```bash
pnpm local:jira:reset
pnpm verify:003
```

The final report must prove:

- all US1–US4 independent checkpoints green;
- all FR-001…FR-029 and SC-001…SC-007 mapped to tasks/tests/evidence with no orphan;
- feature-001 and feature-002 final reports still validate and smoke unchanged;
- 1.0 operational capability fixtures remain green;
- PostgreSQL 17/18 migration matrix green;
- architecture/security/redaction/production-boundary gates green;
- duplicate issue/defect/link/comment count from automatic retry is zero;
- known stale command effect count is zero;
- audit chain complete;
- constitutional exceptions count is zero.

## 17. Troubleshooting contract

| Symptom | Safe diagnosis |
|---|---|
| Prerequisite gate fails | Complete 001/002; do not patch around missing foundation |
| Node engine failure | Activate Node 24.20.0 before pnpm commands |
| Testcontainers unavailable | Start supported container runtime; do not replace PostgreSQL tests with in-memory proof |
| Profile `MAPPING_REQUIRED` | Re-run discovery, create/validate a new Profile version; never edit published version |
| Command `CONFLICT` | Review current projection, prepare a new intent and new exact approval |
| Command/effect `AMBIGUOUS` | Use authorized ambiguity resolution; never force blind retry |
| Connection `AUTH_BLOCKED` | Rotate/revoke via secret owner, revalidate least privilege; do not log token |
| Projection `STALE` | Inspect Profile budget/run health, trigger scoped reconciliation if authorized |
| Import not adopted | Check strict scope, discriminator, verified creator and live entitlement without disclosing issue to unauthorized actor |
| Webhook rejected | Check exact raw-body verification, Connection/delivery identity and Profile scope; do not replay with reconstructed JSON |

## 18. Stop local session

```bash
pnpm local:jira:down
```

The safe reset command may remove only explicitly named local fixture data/containers. It must not target a workspace root, corporate Jira or non-local secret. Verification reports and append-only audit fixture evidence are preserved according to the local retention policy.
