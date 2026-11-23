# Research and decisions — Feature 008

**Date:** 2026-09-03. Repository evidence includes uncommitted Feature 007 files.
External protocol claims require C1 pinning to the actual installed version.

## R01 — Complete the non-local composition

**Decision:** share domain contributions while providing distinct local/corporate
factories; retain separate runtime/deployment/target-environment dimensions.

**Evidence:** `apps/api/src/main.ts` and `apps/worker/src/main.ts` choose Core-only
modules for non-local profiles. `runtime-composition/src/non-local.composition.ts`
contains Core-only entities. GitLab authority factories, S3 transports and current
QA identity wiring are local-only. Worker probe/retention adapters include stubs.

**Rationale:** accepting a profile name does not produce a working QA runtime.
**Alternatives:** remove local guards or copy local bootstrapping; rejected.

## R02 — Preserve C1 input discipline

**Decision:** validate provider edition/version, auth, sanitized metadata, scope,
permissions and API contract before concrete corporate adapter implementation.
L0 contracts/fixtures and the conditional work are fully planned now.

**Rationale:** the external-systems request explicitly requires C1 for real
connector plans. **Alternatives:** guess Jira Cloud or a GitLab version; rejected.

## R03 — Optional storage, mandatory evidence

**Decision:** introduce explicit GitLab-only evidence source policy and a separate
corporate object-store adapter when required. Preserve existing local guards.

**Evidence:** `AwsV4S3Transport` and `S3CompatibleObjectStorage` in
`runtime-composition/src/storage/s3-compatible-object-storage.ts` both reject
nonlocal endpoints, while configuration unconditionally requires S3.

**Rationale:** FR-008-003 allows optional storage, not absent required artifacts.
**Alternatives:** always require S3 or waive evidence during outages; rejected.

**Implemented adapter (2026-09-04):** distinct scoped S3 adapter signs exact
SigV4 requests over the pinned network transport. Content-addressed conditional
writes are reconciled through checksummed, version-pinned reads; an uncertain
write never causes an automatic new PUT. Workload credentials remain an injected
scoped port. Source sufficiency checks require current authorized observations,
exact GitLab profile/connection pins and sufficient retention. Required manual
attachments remain unavailable in GitLab-only mode unless policy explicitly
permits a qualifying existing GitLab reference. API factory wiring remains T025.
[AWS SigV4 requests](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html),
[conditional PutObject and version response](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html),
[S3 checksums](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html).

## R04 — Unknown effects and non-atomic state checks

**Decision:** retain `SAFE_RETRY / LOOKUP_REQUIRED / NONE_AMBIGUOUS`, durable
invocation markers, provider readback and quarantine. Never infer an atomic CAS
from a pre-read/post-read strategy or native POST idempotency from a custom header.

**Rationale:** Jira search may lag, so zero results after a lost create response
cannot prove no effect. GitLab pipeline triggers target a ref; confirm actual SHA
and exact attempt marker after response/lookup. Webhook delivery dedupe does not
imply trigger POST idempotency.
[Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/),
[Jira issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/),
[GitLab triggers](https://docs.gitlab.com/api/pipeline_triggers/).

**Alternatives:** unconditional POST retry or a fresh effect key per attempt;
rejected. Restore must inspect effects newer than the restored database.

## R05 — Exact webhook dialects

**Decision:** pin native integrity/freshness/replay capabilities; retain signed
proxy plus opaque intent for Mattermost when needed to meet FR-008-007. The proxy
must first authenticate the original source, not sign arbitrary public requests.

**Evidence:** Jira Cloud admin webhook HMAC covers the body; delivery ID is a
separate header. OAuth webhooks have a different auth dialect. Current Jira Data
Center admin documentation also supports body HMAC, so DC must not be described
as universally unsigned. GitLab Standard Webhooks signing is version-dependent
(introduced 19.0, GA 19.1); legacy `X-Gitlab-Token` is not a signature. Mattermost
interactive messages use confidential context/unguessable action identifiers.
[Jira Cloud webhooks](https://developer.atlassian.com/cloud/jira/platform/webhooks/),
[Jira DC webhooks](https://confluence.atlassian.com/adminjiraserver/managing-webhooks-938846912.html),
[GitLab webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/),
[Mattermost interactive messages](https://developers.mattermost.com/integrate/plugins/interactive-messages/).

**Rationale:** signature, receipt timestamp and authenticated event freshness are
different proofs. **Alternatives:** silently downgrade to a token; rejected.

## R06 — Pinned access-token policy

**Decision:** extend `platform-runtime-nest/src/auth/oidc-auth.guard.ts` and wire it
into actual corporate routes. Pin issuer/audience/JWKS/algorithms, required lifetime
claims, token dialect, skew, maximum age and step-up semantics. API rejects ID
tokens. Vendor JWT access tokens require a validated discriminator; opaque tokens
need an authenticated introspection adapter or an explicit unsupported result.

**Rationale:** RFC 9068 requires its access-token `typ`, but not every provider uses
that profile. Fresh refresh does not prove fresh human authentication.
[RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html),
[RFC 7662](https://www.rfc-editor.org/rfc/rfc7662.html).

**Alternatives:** accept any signed JWT or require at+jwt from every IdP; rejected.

## R07 — Vault resolution and signature history

**Decision:** bridge existing scoped `SecretResolverPort`/lease contracts; use
workload identity and distinct policies. Pin credential rotation behavior and
remote signing key version. For detached JWS, sign the exact existing signing-input
bytes and normalize the returned envelope without changing manifest semantics.

**Rationale:** KV v2 defaults to latest without a version. Transit exposes exact
`key_version`; its minimum decryption version also affects old-signature
verification. Preserve immutable public keys and approved revocation semantics
through evidence retention/restore. Private keys stay in Vault.
[KV v2 API](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2),
[Transit API](https://developer.hashicorp.com/vault/api-docs/secret/transit),
[Workload authentication](https://developer.hashicorp.com/vault/docs/auth/kubernetes).

**Alternatives:** export private keys, re-sign history or silently use latest;
rejected. Workload auth choice remains C1 deployment input, not Kubernetes assumed.

**Connector bridge (2026-09-04):** corporate factories preserve the historical
GitLab `secretref://` contract alongside Core `secret-ref:` references. Each purpose
requires a distinct approved Vault location and exact allowed-use hash. A lease
expiry also aborts the active network request. Both Vault and provider traffic use
the same explicitly supplied pinned network transport. PostgreSQL service
authorization uses current membership, roles, entitlement and published chain;
write clients require existing durable command admission and effect guards.

Jira Basic authentication encodes the approved user/token pair; bearer is a
separate explicit protocol selection. Native GitLab trigger requests carry
`ref`, `token` and the selected inputs/variables map. A top-level local fixture
`name` is never forwarded: an approved workflow input must provide pipeline
naming, otherwise trigger conformance is missing. None of these implementations
asserts support on an unknown corporate installation.
[Jira Basic protocol](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/),
[GitLab trigger request](https://docs.gitlab.com/api/pipeline_triggers/),
[Mattermost API authentication](https://github.com/mattermost/mattermost/blob/master/api/v4/source/introduction.yaml).

## R08 — Actual fenced restore

**Decision:** backup manifest, isolated restore, provider reconciliation and
measured RPO/RTO. Include audit, configuration, key history and artifact inventory.

**Rationale:** PITR needs base backup and continuous archived WAL; logical dump is
a different mechanism, and PostgreSQL configuration needs separate backup.
[PostgreSQL backup documentation](https://www.postgresql.org/docs/18/continuous-archiving.html).
The 007 recovery checkpoint tests recovery logic, not actual database restore.

**Alternatives:** Redis reset or in-memory fixture replay; not a restore proof.

## R09 — Real and safe telemetry export

**Decision:** initialize SDK/exporters before modules, flush on shutdown and test
Collector receipt. Filter before export and again in Collector. Use bounded metric
labels; put IDs in scoped trace/audit joins. Replace raw exception logging.

**Evidence:** `platform-runtime-nest/src/observability/telemetry.ts` forwards safe
IDs to metrics; `infra/observability/otel-collector.yaml` exports to debug.
[OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)
describes filtering processors; the application still owns its data policy.

**Alternatives:** stdout alone or redaction only after export; rejected.

**Implemented adapter review (2026-09-04):** exact Node SDK 2.11.0 and OTLP
HTTP/JSON exporters 0.222.0, compatible with existing API 1.9.1 and Node 24.20.0.
Providers are explicit; resource discovery and automatic instrumentation are not
enabled. The SDK scrubs span names/attributes/status/events and metric attributes;
Collector processors repeat the privacy filter. Buffering, cardinality, export
timeouts and shutdown are bounded. Independent tests cover actual SDK receipt,
mTLS Collector receipt and PostgreSQL command correlation after reconstruction.
[Official exporter guide](https://opentelemetry.io/docs/languages/js/exporters/)
and [SDK release](https://github.com/open-telemetry/opentelemetry-js/releases/tag/v2.11.0)
were reviewed alongside installed package types/transport implementations.

`config/pilot/otel-dependency-review.json` pins the exact lockfile addition and
audit report. All prior dependency records must compare equal after pruning only
these reviewed additions. The production dependency audit has no OTel findings;
two existing moderate `qs` advisories remain tracked for the release scan phase.
This npm audit is not a release-image or corporate deployment attestation.

## R10 — Exact evidence and honest rollout status

**Decision:** immutable execution attestations with source/config/image/input/suite
hashes; PASS, FAIL, BLOCKED_INPUT and SKIPPED_GATED remain distinct. Old PASS becomes
stale in the projection, not edited in history. Local and corporate results differ.

**Rationale:** 007 already uses source-bound reports but explicitly limits them to
local conformance. **Alternatives:** one green readiness flag; rejected.

## R11 — Baseline, evaluation and rollback

**Decision:** current-process baseline before numeric targets; freeze comparison
protocol before the pilot window. Preserve samples/exclusions/censoring and human
spot-checks. Hermes evaluation covers exact DRAFT/CANDIDATE/WORK_ITEM scopes,
injection, low-confidence and model outage. Scores never authorize human actions.

**Rationale:** small/biased samples must not be reported as proven improvement.
**Alternatives:** choose targets or exclusions after seeing results; rejected.

**Decision:** suspend through 007; rollback uses compatible pinned image/config,
never destructive down-migrations or stale rewrites of external authority.

## Outcome

Design choices are resolved. Company endpoints, topology, owner names, policy,
RPO/RTO, dates and targets remain explicit deployment inputs with deterministic
blocked behavior. No real corporate conformance or pilot success is claimed.
