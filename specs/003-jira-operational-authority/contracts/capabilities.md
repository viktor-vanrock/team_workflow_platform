# Typed capabilities: Jira operational authority

## 1. Provider-neutral capability

The QA Pack declares logical requirements; it never selects a Connector or Jira object:

| Requirement | Logical role | Profile scope | Required operations |
|---|---|---|---|
| `qa-request-authority` | `QA_REQUEST_AUTHORITY` | one central QA project plus exact Platform Project discriminator | `request.create`, `request.transition`; optional-enabled `request.assign`, `request.set-priority`, `request.set-due-date` |
| `source-context` | `SOURCE_CONTEXT` | project-specific read/JQL/link allowlist | no Pack-callable write; Connector infrastructure read/link sub-effect only |
| `defect-destination` | `DEFECT_DESTINATION` | one owning product project | `defect.create` |

Resolution key remains:

```text
workspaceId + projectId + environmentScope + capabilityKey + logicalRole
```

Exactly one published compatible chain must resolve. Client input cannot contain Binding/Profile/Connection/Mapping refs, endpoint, secret, Jira project key, field ID, transition ID or JQL.

## 2. `operational-work-item@1.1.0`

### 2.1. Compatibility

Version 1.0 operations, target schema and payload/result meanings are unchanged:

```text
request.create
request.transition
defect.create
```

Version 1.1 adds three separately typed optional operations and an additive transition-input schema for Profiles that opt into the expanded normalized workflow:

```text
request.assign
request.set-priority
request.set-due-date
```

A 1.0 Profile remains valid for its exact pins and cannot receive a 1.1-only command. A Binding that enables a 1.1 action must pin a Profile implementing that exact operation.

The original 1.0 `request.transition` input remains byte-for-byte unchanged (`READY | DONE`). A 1.1 Profile may pin the additive expanded input schema; old inputs remain valid with identical meaning. Runtime validates against the exact Profile-pinned schema rather than reinterpreting historical commands.

### 2.2. Operation matrix

| Operation | Target | Input | Expected external state | Confirmation | Approval |
|---|---|---|---|---|---|
| `request.create` | REQUEST natural key | structural request create | `MUST_NOT_EXIST` + effect marker | marker lookup + issue read + required sub-effects | confirmed intake/import policy, no extra exact approval |
| `request.transition` | REQUEST immutable external ID | normalized target + optional closed completion summary | revision token + current raw/normalized status | transition availability pre-read + issue post-read + required comment receipt | exact |
| `request.assign` | REQUEST immutable external ID | verified principal ref or explicit unassign | revision token + current assignee | issue post-read | exact |
| `request.set-priority` | REQUEST immutable external ID | normalized priority key | revision token + current priority | issue post-read | exact |
| `request.set-due-date` | REQUEST immutable external ID | ISO date or explicit clear | revision token + current due date | issue post-read | exact |
| `defect.create` | DEFECT natural key | immutable approved defect content and safe refs | `MUST_NOT_EXIST` + effect marker | marker lookup + defect read + exact QA Request link | exact |

There is no `request.update`, `execute(any)`, arbitrary field patch, arbitrary comment or arbitrary link operation.

### 2.3. Target

Target is closed:

```text
OperationalTarget = {
  workspaceId,
  projectId,
  entityKind: "REQUEST" | "DEFECT",
  authorityScopeKey,
  exactlyOneOf: naturalKey | externalEntityId
}
```

External display key is diagnostic and never the immutable identity. Connector derives project/type/endpoint from the pinned Profile.

Defect linkage remains in the unchanged 1.0 `defect.create` payload (`sourceWorkItemId`) and trusted auxiliary execution context; it is not added as a required target member.

### 2.4. Expected revision

Request mutation expected state contains:

```text
{
  externalRevisionToken: Digest,
  expectedRawStatusId?: string,
  expectedNormalizedStatus?: NormalizedStatus,
  expectedAssigneeExternalId?: string | null,
  expectedPriorityId?: string | null,
  expectedDueDate?: string | null,
  authorityFieldsHash: Digest
}
```

Only the fields relevant to the operation are required, but the full token/hash remains exact Approval input. Jira transition ID is absent; Connector resolves it after fresh transition discovery against the Profile mapping.

### 2.5. Normalized result

Every success returns a complete `OperationalAuthoritySnapshot`:

- immutable external ID and current display key/web URL;
- adapter-generated external revision token and provider updated/changelog refs;
- raw status ID/name and normalized status;
- requester/assignee external refs plus verified canonical refs where resolved;
- raw/normalized priority and due date;
- exact required sub-effect receipts;
- effect marker/effect ID, observation source/time and sanitized content hash;
- exact Profile/Mapping/Connection/Binding refs are supplied by the trusted command context and validated by confirmation, not copied from provider body.

Result never contains raw response, token, unrestricted description/comment/evidence or arbitrary Jira field map.

## 3. Connector infrastructure ports

These ports are statically registered with runtime composition and are not callable by Pack/UI/model:

### `CommandConfigurationSetResolverPort`

- resolves all operation-declared primary/auxiliary logical roles from one exact Project Integration Binding version;
- returns an immutable ordered set of Binding/Profile/Mapping/Connection hashes before command persistence;
- rejects undeclared cross-authority links; Connector never calls the registry itself.

### `ExternalPrincipalResolutionPort`

- takes a canonical principal ref from trusted command context after live authorization;
- returns an opaque provider subject pinned to the Connection authority namespace;
- never accepts provider account/user IDs from HTTP or Pack payloads.

### `ConnectorDiscoveryPort`

- discover server/dialect/capabilities;
- discover exact project/issue type/field/context/status/transition/priority/user/link metadata;
- validate permissions and safe JQL scope;
- produce immutable sanitized discovery snapshot/diagnostics.

### `OperationalObservationPort`

- read one known bound issue by immutable ID;
- search strict import scope;
- normalize authoritative issue to a complete provider-neutral observation;
- return ordering token/hash and sanitized error taxonomy.

### `ConnectorWebhookNormalizerPort`

- verify dialect-supported signature/delivery identity over exact raw bytes;
- normalize only routing/change hints;
- never return canonical projection values or execute effects.

### `ConnectorReconciliationPort`

- run Cloud token or DC offset pages under a generic watermark/overlap plan;
- report transient page state, rate metadata and normalized observations;
- never own the durable cross-run cursor or Work Item mutation.

### `ConnectorProfileValidationPort`

- compile bounded mapping;
- bind all configured IDs to discovery snapshot;
- preview and read-only dry-run;
- return closed validation/drift issues and content hashes.

## 4. Jira Profile contracts

### Central QA Request Profile

Requires:

- exact project/issue type/discriminator/effect-marker IDs;
- create and strict import JQL scope;
- field/status/priority/identity mappings;
- allowed normalized transition graph and operation allowlist;
- source link/comment/remote-link rules;
- verified-human import mode;
- webhook/reconciliation/freshness/rate/concurrency policies.

### Source Context Profile

Read-only exact project/issue type/JQL scope plus link type/direction and remote-link allowlist. It never grants Project Entitlement and never enables arbitrary Jira read.

### Defect Profile

Requires exact target project/issue type, required/allowed fields, searchable marker, deterministic duplicate-candidate query, exact QA Request link type/direction and `EXACT_APPROVAL` write policy.

## 5. Idempotency and partial effects

- Gateway creates one stable globally unique effect key.
- Connector searches the exact published marker before any create retry.
- `0` safe/proven matches may create; `1` exact semantic match reconciles; `>1` is conflict; uncertain visibility is `AMBIGUOUS`.
- Multi-step create/defect/close records an ordered sub-effect plan.
- Link retry reads exact link tuple; remote link uses deterministic globalId; comment retry reads deterministic marker.
- A 2xx is not confirmation. Final authoritative read and required sub-effect receipts are mandatory.
- Same effect key with different target/payload hash is an idempotency/security conflict.

## 6. Conflict and retry

- fresh pre-read token/value mismatch: `CONFLICT`, zero Jira write;
- post-read expected result: confirmed;
- post-read different comparable value: `CONFLICT`;
- possibly started effect with uncertain marker/state: `AMBIGUOUS`, no blind retry;
- 401/403: `AUTHENTICATION|PERMISSION`, automatic retry stopped;
- 429: `RATE_LIMIT`, honor Retry-After and budget;
- 5xx/timeout: `TRANSIENT`, reconcile before write retry;
- missing field/status/transition/link mapping: `MAPPING_DRIFT`, affected Profile only;
- missing issue: `NOT_FOUND`, Profile policy decides tombstone/alert, never silently creates replacement.

## 7. Conformance vectors

Every Connector implementation used by 003 must prove:

1. repeated/concurrent create produces one observable issue or a visible ambiguity, never an automatic duplicate;
2. crash after issue create/link/comment but before platform confirmation reconciles the same effect;
3. stale token existing before write produces conflict and zero effect;
4. assignment/priority/due cannot smuggle another field or Jira ID;
5. transition selects only a currently available Profile-mapped transition;
6. requested value is not returned as confirmed before authoritative read;
7. duplicate/out-of-order webhook cannot mutate projection directly;
8. wrong project/Profile/Connection/identity is rejected before disclosure/effect;
9. 401/403, 429, 5xx, timeout, schema drift and ambiguous response use the closed taxonomy;
10. raw provider body/token and arbitrary fields never cross the Connector boundary;
11. 1.0 fixtures remain accepted unchanged;
12. Jira Cloud/DC dialect-specific pagination, identity and rich-text values normalize to the same provider-neutral result.
