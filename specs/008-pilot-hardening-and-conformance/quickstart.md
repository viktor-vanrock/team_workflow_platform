# Quickstart and validation guide — Feature 008

**Implementation status (2026-09-05):** the complete local engineering contour is
implemented and verified with explicit development adapters. Foundation, US1–US5,
compatibility, PostgreSQL 17/18 migrations, security, browser, smoke and the local
aggregate produce source-bound evidence. Corporate C1/N2, release scan, recovery
drill, shadow window and observed pilot review remain `BLOCKED_INPUT` until their
real approved inputs and evidence are supplied.

## Runnable development contour

```bash
pnpm dev:pilot:up
pnpm dev:pilot:status
node tools/smoke/008-development.mts
pnpm dev:pilot:down
pnpm verify:008:foundation
pnpm verify:008:quickstart
pnpm smoke:008
```

Open <http://localhost:55173>, select `Requester · ALPHA`, and switch persona.
Create and explicitly confirm a QA draft; the worker creates it in the Jira mock.
The smoke confirms the same draft twice and independently verifies one provider
POST. Collector receives actual API/worker telemetry.
See [development runbook](../../docs/runbooks/pilot-development.md) for ports,
adapters, controlled failures, data preservation and the evidence boundary.

## Prerequisites

- Existing repository Node/pnpm versions, dependencies and Docker prerequisites.
- Current source-bound Feature 007 PASS, including its uncommitted source files.
- Local tests use disposable resources, synthetic identities and deny external
  network access. Never restore over the running local stack.
- Corporate stages require [pilot-inputs.md](pilot-inputs.md) and exact approved
  scope/configuration; missing inputs remain blocked.

The owner-facing collection form and exact evidence formats are in the
[corporate integration intake](../../docs/runbooks/pilot-integration-intake.md).

From repository root, the existing prerequisite command is:

```bash
pnpm prerequisites
```

## Verified local sequence

Setup registers and validates the full command catalog. The complete local sequence
is executable from the repository root:

```bash
pnpm verify:008:prerequisites
pnpm verify:008:setup
pnpm verify:008:foundation
pnpm verify:008:compatibility
pnpm verify:008:migrations
pnpm verify:008:quickstart
pnpm verify:008:us1
pnpm verify:008:us2
pnpm verify:008:us3
pnpm verify:008:us4
pnpm verify:008:us5
pnpm smoke:008
pnpm ci:008
```

Each checkpoint invokes actual tests/scenarios, validates exact child evidence and
returns nonzero for its required failed/blocked checks. `ci:008` is L0-only; a
separate readiness summary shows corporate prerequisites as BLOCKED_INPUT or
SKIPPED_GATED. Those statuses cannot satisfy any required local or corporate gate.

| Checkpoint | Reproducible independent scenario | Required observations |
|---|---|---|
| Prerequisites/setup | Validate 007 source/contract/migration evidence, command catalog and 008 input/report contracts | Reject stale/copied PASS and unknown unsafe config |
| Foundation | Two-workspace/project fixture, exact gate pins and effect fence | Default deny; no external egress; immutable records/CAS |
| US1 | Complete API/worker with local OIDC/secret/signing/Collector adapters; manual request and allowed automation | Stable identity/scope, no local persona in corporate wiring, correlated real exports and secret-free output |
| US2 | Stateful Jira/GitLab/MM faults, lost write response, revoked scope and worker restart | Unrelated work continues; unknown effects reconcile; no duplicate external effects |
| US3 | Adversarial access/approval/ingress/canary corpus and model outage/rollback | Zero bypass; no leakage; human decisions remain separate |
| US4 | Backup, external write after backup, isolated DB restore, Redis reconstruction and provider reread | Real restored state/signatures/artifacts; old-instance fence; no duplicate replay; measured timing |
| US5 | Synthetic baseline then frozen comparison protocol, shadow, exact activation, cohort expiry/suspension and review | Zero shadow writes/backlog; durable one-time activation; honest sample/guardrail report |

Fault injection must travel through the actual route/worker/adapter path and use
independent provider state counts. Function-only mocks do not prove startup wiring,
safe dispatch or restoration. Local signer/secret/IdP fixtures have failure and
rotation modes, not fixed always-success responses.

## Corporate sequence

Populate an approved secret-free `config/pilot/input-package.json` from the input
catalog. It is deployment data and is not created with guessed values during
planning. Resolve credentials only through approved secret references.

```bash
pnpm verify:008:inputs -- --input config/pilot/input-package.json --stage C1
pnpm verify:008:inputs -- --input config/pilot/input-package.json --stage N2
AWP_008_N2_EVIDENCE_BUNDLE=reports/008-pilot-hardening-and-conformance/corporate-n2-evidence.json \
  pnpm verify:008:integration -- --input config/pilot/input-package.json
AWP_008_RELEASE_IMAGE_DIGEST=sha256:<approved-image-digest> \
AWP_008_RELEASE_SCAN_BUNDLE=reports/008-pilot-hardening-and-conformance/release-security.json \
  pnpm verify:008:security
pnpm verify:008:recovery -- --input config/pilot/input-package.json
pnpm verify:008:shadow -- --input reports/008-pilot-hardening-and-conformance/corporate-shadow.json
pnpm verify:008:review -- --input reports/008-pilot-hardening-and-conformance/limited-pilot.json
```

The input package pins the authorized sandbox run scope, signed ingress strategy,
release/image/config digests, scan policy, explicit disposable restore target,
owner and fence proofs. Integration fault writes stay in that sandbox. Missing
scope/owner/target/permission stops the corresponding command before I/O.

Expected order: C1 metadata → N2 sandbox → security/recovery → shadow → exact
activation in existing Project onboarding UI → limited pilot window → review.
Security gate scans the actual approved image/dependencies. Recovery gate uses
approved RPO/RTO; local fixture timing cannot satisfy corporate limits.

Shadow shows copied observations with no Jira/GitLab/MM business writes. Inspect
the readiness view, gate fingerprints, cohort/end date and rollback/on-call
readiness before human activation. Activation uses the existing 007 exact action;
there is no CLI shortcut bypassing approval. A completed pilot report is not a
prerequisite to its first activation.

After the actual pilot window and human spot-checks:

```bash
pnpm verify:008:review -- --input reports/008-pilot-hardening-and-conformance/limited-pilot.json
```

The review reports baseline/sample/definitions/incidents/guardrails/operator load,
limitations and the human continue/adjust/stop decision. Missing/insufficient data
cannot become an improvement claim. Do not fabricate the elapsed observation
window or interpret engineering PASS as corporate approval.

## Report inspection and failures

Execution reports are generated under
`reports/008-pilot-hardening-and-conformance/`; their closed envelope is
[gate-report.schema.json](contracts/gate-report.schema.json). Evidence files have
scope, content hashes and source/config/input/suite/image provenance. Aggregation
rehashes child files and rejects tampering, stale configuration and missing data.
Report shape validation is necessary but does not replace authorization or tests.

Expected negative runs: same replay key with changed body → conflict; expired
approval/cohort → deny before effect; OIDC unknown key → deny; Vault outage → no
dev fallback; lost provider response → reconciliation; missing required artifact
→ incomplete evidence; insufficient baseline sample → INSUFFICIENT_DATA.

Incident handling uses existing emergency Project suspension. Preserve in-flight
uncertainty, inspect current provider state and obtain exact resume approval.
Rollback selects compatible pinned runtime/configuration; it does not rewrite
Jira or delete historical evidence. Disposable test resources are cleaned up only
after reports preserve the required evidence.

## Local Hermes evaluation

```bash
pnpm verify:008:hermes
```

Runs 21 versioned synthetic intake/triage/evidence cases through the actual QA
skills, prompt minimization and read-only grant gateway. The provider and access
authority are development fixtures. Reports pin corpus/model/prompt/skill/config
and source hashes; unobserved operations are unknown and fail the run. Corporate
model quality remains `NOT_EVALUATED`.

The evaluated-policy service publishes immutable `MODEL_POLICY` revisions after
loading an exact current HUMAN review through its authority port. Promotion and
rollback invalidate pending triage/session proposals in the same transaction.
QA migration 2100 rejects new recommendations without the exact currently
selected policy reference, including delayed responses from an older run.
Rollback creates a new revision selecting a previously evaluated compatible
candidate. Existing HUMAN decisions remain unchanged. The local runtime wiring is
covered by the aggregate; corporate approval/evaluation still requires its real
provider and human evidence.
