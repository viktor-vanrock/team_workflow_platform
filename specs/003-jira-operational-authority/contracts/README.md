# Phase 1 contracts: Jira operational authority

This directory is the normative interface package for feature `003-jira-operational-authority`. It extends, but does not reinterpret, feature-002 `operational-work-item@1.0.0` and QA contracts.

## Contents

- [capabilities.md](capabilities.md) — typed operation, confirmation, observation and Profile rules;
- `openapi/jira-operational-authority-api.v1.yaml` — provider-neutral HTTP surface for discovery, projection, import diagnostics and typed commands;
- `asyncapi/jira-operational-events.v1.yaml` — scoped import/projection/conflict/reconciliation events;
- `schemas/jira/` — immutable Jira Connection/Mapping/Profile/discovery/webhook configuration contracts;
- `schemas/jira/pilot-metadata-package.v1.schema.json` and `examples/` — machine-checkable local/live C1 gate without secret values;
- `schemas/operational-work-item/` — additive 1.1 inputs/results owned by 003; applied feature-002 files are never edited;
- `schemas/operational-authority/` — provider-neutral projection/import/conflict/reconciliation contracts.

Implementation compiles feature-002 1.0 and feature-003 1.1 documents into one generalized offline registry. Runtime never resolves remote `$ref` values.

## Normative invariants

1. Core, QA Pack, browser UI and Hermes never call Jira REST or import `connector-jira`.
2. A Pack command carries a typed provider-neutral target/payload and logical requirement. It never carries endpoint, credential, Connection/Profile ID, Jira project/field/transition ID or arbitrary JQL.
3. Broker resolves and pins an immutable ordered primary+auxiliary set of exact Project Binding, Profile, Mapping, Connection, adapter family/version and classification refs before persistence/invocation; the full set is effect-time revalidated.
4. Published Connection/Mapping/Profile/Binding versions and discovery snapshots are immutable. A Jira upgrade or mapping change creates a new version and validation report.
5. `operational-work-item@1.0.0` target/input/result documents remain unchanged. Version 1.1 adds closed optional operations, an opt-in additive expanded transition schema and additive result fields under new 003-owned schema identities.
6. `request.transition`, `request.assign`, `request.set-priority`, `request.set-due-date` and `defect.create` require an exact one-time `EXTERNAL_COMMAND` Approval. A client cannot reuse approval or choose a Jira transition ID.
7. Requested operational values remain pending intent. Status/assignee/priority/due become canonical only from authoritative Jira read-back, webhook-triggered read or reconciliation read.
8. Jira webhook payload is an untrusted unordered invalidation signal. It never directly mutates projection or triggers a domain side effect.
9. Direct import creates a Work Item only from a strict published scope and verified HUMAN issue-creation evidence; otherwise it creates a non-disclosing diagnostic and zero Work Items.
10. Webhook/import/reconciliation/command confirmation converge on one external authority identity and one active binding.
11. Jira create/defect has no claimed native exactly-once guarantee. Searchable effect marker plus platform serialization is required; uncertainty stops in `AMBIGUOUS` rather than blindly re-creating.
12. Expected external revision is adapter-generated. Connector performs fresh pre-read, minimum write and immediate post-read. A known mismatch is `CONFLICT` with zero write.
13. Profile mapping is a closed bounded AST. Arbitrary code, executable templates, client JQL fragments and dynamic schema/network access are forbidden.
14. Every project-scoped API/event/entity includes Workspace and Project. The backend resolves actor/scope; body fields cannot substitute them.
15. Secret values and raw provider bodies are forbidden in contracts, commands, events, approvals, audit and examples.
16. Production Jira effects are absent from feature 003 and rejected by environment, credential, policy, composition and network controls.

## Contract identities

| Contract | Version | Compatibility |
|---|---:|---|
| HTTP API | `/api/v1`, document v1 | additive fields/routes within v1; breaking semantics require v2 |
| Event envelope | inherited v1 | new event payload schemas are additive registrations |
| Jira Connection config | 1 | immutable; adapter family/version pinned |
| Jira Mapping | 1 | immutable closed AST |
| Central/Source/Defect Profile | 1 | separate immutable schemas/versions |
| Operational projection/import/conflict/report | 1 | append-only/event/read schemas |
| `operational-work-item` | 1.1.0 | preserves all 1.0.0 operations and history |

## HTTP concurrency and idempotency

- mutation routes require `Idempotency-Key` and strong `If-Match`/expected resource version where a local candidate/header is mutated;
- repeated same key/hash returns the original response; same key/different hash returns RFC 9457 conflict;
- action routes accept provider-neutral values only and return `202` with command/approval refs;
- action bodies do not accept external revision/hash; Core derives them from the server projection selected by `If-Match` and rejects a stale ETag before command creation;
- command/approval status remains owned by existing generic Core routes;
- projection `ETag` identifies the current local read model revision, not a Jira write precondition;
- command preparation reads the current projection and freezes its external revision token/value into the exact subject.

## Observation ordering

An authoritative observation is reduced as:

```text
DUPLICATE | STALE_IGNORED | APPLIED | GAP_REQUIRES_RECONCILIATION
```

The receiver timestamp is never used as the sole order. Same external token with another authority-field hash is a diagnostic/gap, not last-write-wins.

## Error contract

Connector-facing errors normalize to:

```text
AUTHENTICATION | PERMISSION | CONFLICT | RATE_LIMIT | TRANSIENT
VALIDATION | NOT_FOUND | MAPPING_DRIFT | AMBIGUOUS | SECURITY_SCOPE
```

401/403 are non-retryable and alerting. 429/5xx/timeout retry only according to bounded policy and only after safe read/marker reconciliation for writes. Raw provider status/body may inform Connector-local telemetry but is not emitted as business payload.

## Local validation

CI must:

- parse every JSON/YAML file offline and resolve local refs;
- validate positive/negative examples against exact schema IDs/digests;
- prove 1.0 fixtures still pass and 1.1 rejects unknown/generic update operations;
- compare generated OpenAPI/AsyncAPI and Mock Hub snapshots;
- scan contracts/examples for endpoint credentials, personal tokens, production targets and raw provider bodies;
- execute the same typed operation conformance against Mock Connector and Jira protocol adapters.
