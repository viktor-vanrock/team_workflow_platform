# Recovery, security and evaluation contract v1

## Actual restore drill

Operator tooling requires isolated target identity, approved backup ref, recovery
point, owner and write-fence proof. Reject active local/pilot database identities
before destructive work. Never transfer live worker egress to a restored rehearsal.
Destructive commands target only disposable resources.

Inventory canonical/audit/inbox/outbox/effect records, configuration and binding
versions, evidence metadata, public key history, artifact versions/hashes and
secret-store recovery evidence. Application manifests contain no private keys.
Physical PITR proves complete base/WAL/timeline integrity; logical backups are
labeled LOGICAL. Method and targets are inputs, not inferred from local thresholds.

Restore, verify immutable rows/signatures/artifacts, rebuild delivery and reconcile
current Jira/GitLab/Mattermost state. Include a write after backup with lost local
confirmation. Delayed/zero/multiple lookup remains unresolved without proof; never
repeat POST because the restored database lacks a marker. Redis loss preserves
durable intent. Prove former-runtime fencing to prevent split-brain.

Measure RPO from recoverable confirmed writes versus fault point; measure RTO from
fault declaration until defined service checks pass. Preserve timestamp sources
and uncertainty. Missing keys/required bytes, unknown effects or failed targets
block readiness for separately authorized resume.

## Security and scans

Cross at least two Workspaces, two authorized Projects and one forbidden Project,
HUMAN/SERVICE identities, roles/classifications, revoked/expired grants and exact
action snapshots. Cover API search/cache/export/report queries, artifact locators,
webhooks, approval consumption and worker dispatch. Assert against IDOR, route/body
scope mismatch, forged action swap, replay, injection, SSRF, token confusion and
secret leakage. Use actual captured outputs and stateful effect observation.

Dependency/image scans pin lockfile/image digest, tool/version, database freshness,
timestamp/policy and findings. Critical findings must be closed before pilot.
Other severity handling follows approved owner/expiry policy. Missing/stale scan
data or a different image is blocked, never PASS.

## Hermes corpus and rollout

Version synthetic intake/triage/evidence cases with exact subject/scope, allowed
sources, expected schema, tool grants and safety properties. Cover DRAFT/CANDIDATE/
WORK_ITEM, revision/hash drift, retrieved injection, cross-item/project/workspace
bait and secrets. Evaluate completeness, schema, grounding, confidence/reasons,
forbidden mutations and fallback on low confidence/outage. Safety permits zero
unauthorized operations; quality thresholds are versioned from agreed reference
evaluation. High score cannot supply human approval, verdict or priority.

Model/prompt/skill change pins configuration and corpus, passes evaluation before
promotion and has an earlier compatible evaluated rollback revision. Changed
fingerprints invalidate pending recommendations instead of reinterpreting them.

## Measurement definitions and ownership

Every observation records provenance, time source, dedupe key, unit, denominator
and window. Imported baseline has separate provenance; it cannot claim platform
audit completeness retroactively. Owners provide versioned facts:

| Measure | Owner and definition |
|---|---|
| Queue age/WIP/SLA | Core 006 queue facts and exact SLA/calendar/pause snapshots; reuse sla-clock.ts |
| Intake/triage/start | Accepted authoritative timestamps and human actions; missing/unaccepted cases explicit |
| Flow time | Completion minus confirmed acceptance; open requests censored |
| Blocked share | Union of blocked intervals / observed eligible lifetime; no overlapping double count |
| Rework | QA clarification returns / eligible requests, plus returns per request |
| Automation share | QA automated Sessions / total eligible Sessions |
| Assertion/infra/timeout/flaky | QA canonical attempts and session rollups with full retry history |
| Defect quality | Human confirmed/rejected/duplicate findings and explicit denominators |
| Connector reliability | Connector outcomes/eligible invocations and latency, including retries/unknowns |
| Operator load | Recorded reconciliation/incident effort with source provenance |

Reporting composes facts, never recalculates a competing SLA. Freeze window,
inclusion/exclusion, manual/automated strata, sample policy and timestamp mapping.
QA Lead/sponsor approve targets and minimum sample after baseline, before comparison.
Preserve sample sizes, missing/censored data and spot checks. Insufficient data or
incompatible definitions yields INSUFFICIENT_DATA; describe observational limits.

## Guardrail evidence

| Spec guardrail | Required proof |
|---|---|
| Zero cross-scope disclosure | Adversarial checks plus incident/audit review |
| Zero unauthorized writes | Independent provider effects joined to authorization/approval audit |
| Zero retry/replay duplicates | Provider markers/readback counts including post-backup effects |
| Every write audited/correlated | Every observed effect maps to durable intent/result audit |
| Final verdicts have verified evidence | Exact manifest/signature/target/artifact-policy chain and human decision |
| Recommendations cannot become decisions | Separate proposal/human lineage and forbidden-mutation assertions |
| No secrets in state/logs/evidence | Canary scans of actual output plus operational security review |

Missing measurement is unknown, not zero. Local tests prove engineering behavior;
real pilot success requires observed pilot evidence. Any confirmed breach blocks
expansion regardless of efficiency.
