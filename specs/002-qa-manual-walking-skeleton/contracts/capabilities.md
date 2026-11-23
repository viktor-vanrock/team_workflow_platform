# Typed capability: `operational-work-item@1.0.0`

## Identity and resolution

The QA Pack declares logical requirements, never a Connector/Profile/Connection:

| Requirement | Requiredness | Logical role | Operations |
|---|---|---|---|
| `qa-request-authority` | REQUIRED | `QA_REQUEST_AUTHORITY` | `request.create`, `request.transition` |
| `defect-destination` | CONDITIONAL | `DEFECT_DESTINATION` | `defect.create` |

Core resolves exactly one published chain by:

```text
workspaceId + projectId + environmentScope + capabilityKey + logicalRole
```

Zero or ambiguous resolution is an error. Pack/client payloads cannot carry Profile ID, Connection ID,
endpoint, secret ref or vendor project key.

Requirement keys are lowercase `StableKey` values required by the published feature 001 command
contract. Uppercase values are opaque `LogicalRoleKey` values owned by the QA Pack; Core does not
interpret them.

## Operation matrix

| Operation | Effect | Target schema | Input schema | Result schema | Idempotency | Confirmation |
|---|---|---|---|---|---|---|
| `request.create` | WRITE | `operational-target` (`REQUEST`, natural key) | `request-create` | `operational-result` | required; native key or natural-key lookup | sync receipt + read-back/reconciliation |
| `request.transition` | WRITE | `operational-target` (`REQUEST`, external ID) | `request-transition` | `operational-result` | required; effect key + expected external version | read-back, webhook or reconciliation |
| `defect.create` | WRITE | `operational-target` (`DEFECT`, natural key) | `defect-create` | `operational-result` | required; native key or natural-key lookup | sync receipt + read-back/reconciliation |

Capability exposes exactly these three write operations. Every operation has a separate closed
schema. A universal `execute(any)` and a Pack-callable `read-back` operation are forbidden.
Read-back/webhook/reconciliation is the generic feature-001 confirmation strategy used after a
write; it is not an operation key or result enum value.

## Approval policy

Approval is not Connector metadata and is not encoded as an inline operation field:

- `request.create` follows explicit confirmed intake and normal authorization; policy may mark a
  second approval `NOT_REQUIRED`. Its summary is the non-empty human title; description and
  acceptance outcome are optional and omitted when the initial DoR input revision lacks them;
- `request.transition` uses the generic exact Approval path for `READY` and `DONE` mutations;
  final `DONE` may be initiated only by the currently authorized HUMAN Executor and additionally
  requires a distinct, currently authorized QA Lead approval; QA Lead initiation is forbidden;
- `defect.create` uses the generic exact Approval path after human acceptance of a PRODUCT draft;
- the sole DoR `PROJECT_REGISTRY_NEEDS_REVIEW` waiver, plan-item/session/required-session/Finding
  waivers, `ACCEPTED_RISK` and risk co-sign are generic `PLATFORM_ACTION`s,
  not Connector operations.

Feature 002 has no DOD waiver. Every pre-close DoD blocker is non-waivable. All DoR blockers except
the exact Project Registry review code are likewise non-waivable.

Attachment/evidence is never waivable in feature 002; negative outcomes without evidence are
rejected before any completion or Connector effect. A Finding `WAIVED` disposition requires an exact
distinct-QA-Lead platform action and does not waive evidence from an already executed negative lineage.

QA resources store only generic `approvalRef`/`platformActionRef`. Full exact subject, payload hash,
expected state, Binding/Profile refs, approver basis, expiry and effect key remain in Core.

## Effect and confirmation rules

- Gateway creates the global `effectIdempotencyKey`; client request keys never reach Connector.
- Retry/crash recovery reuses the same target, payload, expected state and effect key.
- `request.create` and `defect.create` use stable Pack-owned natural keys to reconcile an ambiguous
  started effect; the Connector maps them to provider-native idempotency where available.
- A write is not confirmed by HTTP acceptance alone. The generic confirmation strategy must derive a
  normalized result with exact external entity ID, version, `normalizedStatus`, natural key and
  observed time.
- `request.transition(DONE)` carries one closed deterministic completion summary containing scope,
  Verdict, residual risk and exact platform evidence/defect references. The same canonical bytes are
  covered by `completionSummaryHash`; the Connector materializes the comment in the same idempotent
  transition effect and read-back returns a sanitized receipt with the same hash. `READY` forbids it.
- Before a `request.transition(DONE)` outbox row is appended, the QA service atomically rechecks the
  candidate-pinned adjudicative aggregate hash against the extension CAS owner and moves both the
  Candidate and extension completion guard to `DISPATCHED`. Aggregate drift invalidates a
  pre-dispatch Candidate with zero effect; an in-flight guard rejects adjudicative mutations.
  Terminal `FAILED` releases the guard, while confirmed `DONE` freezes it.
- Same effect key with a different target/input hash is `IDEMPOTENCY_CONFLICT`.
- Raw provider body, token, URL and mutable provider workflow metadata are forbidden.
- Wrong Workspace/Project/Profile result is rejected before confirmation UoW.

## State normalization

Feature 002 reuses the published Core 001 `NormalizedStatus` without a competing enum:

```text
NEW | NEEDS_INFO | READY | PLANNED | IN_PROGRESS | REVIEW | BLOCKED | DONE | CANCELLED
```

`request.create` requests and confirms canonical `NEW`; `request.transition` requests `READY` or
`DONE`; `defect.create` confirms canonical `NEW`. Provider-specific tokens are retained only as
sanitized `rawExternalState` and mapped by the Connector/Profile, for example mock `BACKLOG → NEW`,
`OPEN → NEW`, `CLOSED → DONE`. Conformance tests must exercise every declared raw→normalized mapping
and reject undeclared tokens. Final close is valid only after confirmation derives
`normalizedStatus=DONE`; dispatch/acceptance alone is not completion.

## Conformance requirements

Mock and alternate implementation must prove:

1. all three operations validate exact target/input/result schemas;
2. effect key and natural key replay return the same normalized entity;
3. expected-version conflict performs zero mutation and yields normalized conflict;
4. timeout after effect reconciles to one entity/effect;
5. 401/403, 429, 5xx, timeout and schema drift produce sanitized retry taxonomy;
6. result from wrong Workspace/Project or unexpected external ID is rejected;
7. no operation accepts Jira fields, arbitrary transition IDs, endpoint, credential or Profile;
8. generic confirmation does not introduce a fourth capability operation and returns monotonic external version;
9. audit receives normalized hashes/codes, never raw provider response.
10. DONE conformance renders the structured completion summary once, confirms an identical digest
    and sanitized receipt on replay/read-back, while READY performs no completion-comment effect.
