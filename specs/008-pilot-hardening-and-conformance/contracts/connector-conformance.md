# Connector conformance and degradation contract v1

## C1 protocol record

For each exact Connection/Profile/Mapping revision record provider edition/version,
API/auth dialect, capabilities, permissions, external scope, classification,
native idempotency/CAS guarantees, reconciliation strategy, webhook integrity and
freshness guarantees, rate/timeout/size bounds and sanitized discovery evidence.
Reuse existing dialect schemas. C1 locks concrete adapter inputs; N2 verifies the
real sandbox; pilot revalidates exact configuration. Mock behavior cannot prove
provider guarantees. Unknown versions stay blocked.

## Ingress

Bound raw byte size/media type/route, authenticate source, verify integrity and
freshness, then resolve exact project binding before business-event acceptance.
Protected pending receipts may support async authoritative reread but are not
trusted domain events. A 2xx acknowledgment does not mean state transition success.

| Dialect | Conformance obligation |
|---|---|
| Jira Cloud admin HMAC | Raw body verification; bind tenant/connection + delivery ID + body hash; unsigned headers are not HMAC-covered |
| Jira Cloud OAuth | Selected documented auth dialect; do not treat as admin HMAC |
| Jira DC HMAC | Discover installed-version support; do not inherit Cloud retry/ID guarantees |
| GitLab Standard Webhooks | Verify signed ID/timestamp/raw body, supported signatures, project and retry identity; pin server version |
| Legacy token/unsigned | Cannot satisfy FR-008-007 without validated trusted ingress |
| Mattermost callback | Opaque one-use intent/human binding plus signed-proxy dialect for pilot where native proof is insufficient |

Body-only signatures do not prove signed freshness. Use trusted provider state
timestamp/sequence or an authenticated authoritative reread attested by the ingress
adapter. Late messages reconcile; receipt time alone cannot prove event freshness.
Replaying authenticated bytes with changed unsigned headers must not repeat an
effect. Test forged timestamp/delivery headers and stale valid bodies explicitly.

A gateway must authenticate the originating connection (approved mTLS, private
authenticated route or verified native credential) before signing raw body digest,
source identity, route/method, timestamp, delivery ID and exact scope. Downstream
checks key/version, freshness and durable replay identity. Original callback
intent/event state is still checked; a fresh proxy timestamp cannot revive it.
Signing anonymous requests is nonconformant. Existing Mattermost
SIGNED_PROXY_HMAC_PLUS_AWP_INTENT is the starting dialect.

Same scoped identity/hash is a safe replay; changed hash conflicts. Key overlap,
clock skew and receipt retention are policy inputs. Retry windows exceeding
available replay retention require durable semantic proof or blocked promotion.

## Outbound effects

Use typed broker, persisted approval consumption and exact configuration chain.
Persist invocation intent before I/O; recheck rights, project mode/state,
cohort/window, deployment fence and approved expected state at dispatch. Never
broaden credentials to recover from permission failure.

| Proven strategy | Uncertain result |
|---|---|
| SAFE_RETRY | Same scoped key/hash and bounded policy, only with proven provider guarantee |
| LOOKUP_REQUIRED | Provider marker/readback before any repeat write |
| NONE_AMBIGUOUS | Quarantine; no automatic repeat |

Possibly dispatched timeouts require reconciliation. Zero Jira search matches can
be delayed visibility, not proof of no issue. Multiple/mismatched matches are
divergence. Verify GitLab actual SHA/ref/project against the attempt snapshot;
webhook dedupe is not trigger-POST idempotency. Pre/post reads detect some conflicts
but must not be called atomic Jira CAS. Preserve the proven conflict strategy;
corrective business writes require a controlled new command.

429/retryable 5xx use bounded backoff/jitter, Retry-After and connection budgets.
401/403 stops pending credential/policy repair; schema drift requires investigation.
Business/assertion failures are not transport retries. Preserve every attempt.

## Degradation matrix

| Failure | Continues | Blocks | Recovery proof |
|---|---|---|---|
| Jira | Drafts, stale diagnostic reads, existing notes | Unconfirmed acceptance/authoritative transitions | Durable outbox; no duplicate issue/comment/defect |
| GitLab | Manual Sessions/saved evidence | New automation and fresh pipeline/artifact fetch | Successful probe; no duplicate pipeline; target SHA |
| Mattermost | Web/Jira/manual/automated work | Chat intake/callback/delivery | Deduped expiring notifications and unknown-result lookup |
| Model | Forms/rules/human decisions | Model suggestions | Fallback reason; no autonomous action |
| Artifact source | Metadata/review | Completion needing unavailable bytes | Authorized retry/checksum readback |
| OIDC | Policy-valid unexpired sessions | New login/step-up/expired session | Unknown key denied; no extended lifetime |
| Secret store/signer | Draft/history with valid public data | Effects without valid lease/signature-dependent completion | Rotation/lease recheck; no dev fallback |
| Telemetry | Flow with durable audit | New promotion | Bounded buffers, alert and complete audit |
| Database/audit | Nonmutating diagnostics | Mutations without durable intent/audit | No unrecorded external effect |

Run auth failure, 429/5xx, timeout before/after dispatch, worker crash after effect,
duplicate/out-of-order event, body conflict, forged/stale headers, schema drift,
revoked scope, expired approval and config drift. Count effects independently from
provider observations. Handler return status alone is insufficient evidence.

Reuse Core-owned CapabilityProbeResult with AVAILABLE/DEGRADED/UNAVAILABLE and all
binding/profile/connection/mapping/validation pins. Missing/stale observations
derive UNKNOWN in UI/admission. Do not create a competing connector health authority.
