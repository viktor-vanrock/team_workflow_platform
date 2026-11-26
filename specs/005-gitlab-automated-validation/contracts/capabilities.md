# Provider-neutral automated-validation capabilities

## 1. Manifest identities and resolution

The statically composed automation group for `qa.validation@1.2.0` contains
exactly these capability identities and operations:

| Logical role | Capability | Exact operation | Effect |
|---|---|---|---|
| `SOURCE_CONTEXT` | `source-context.read@1.0.0` | `merge-request.read` | `READ` |
| `SOURCE_CONTEXT` | `source-context.read@1.0.0` | `commit.read` | `READ` |
| `SOURCE_CONTEXT` | `source-context.read@1.0.0` | `build.read` | `READ` |
| `TEST_EXECUTION` | `test-executor.trigger-status@1.0.0` | `pipeline.trigger` | `WRITE` |
| `TEST_EXECUTION` | `test-executor.trigger-status@1.0.0` | `pipeline.read` | `READ` |
| `TEST_EXECUTION` | `test-executor.trigger-status@1.0.0` | `pipeline.lookup` | `READ` |
| `ARTIFACT_SOURCE` | `artifact.ci-read@1.0.0` | `artifact.metadata` | `READ` |
| `ARTIFACT_SOURCE` | `artifact.ci-read@1.0.0` | `artifact.stream` | `READ` |

These names are exact. Aliases such as `test-execution.trigger`, generic
`execute`, `status`, `artifact.read` or provider-prefixed operation names are
not compatible with version `1.0.0`.

The normative serialized unions are closed by operation and live in:

- [`source-context-read.v1.schema.json`](schemas/source-context-read.v1.schema.json)
  with `$id` `urn:awp:schemas:005:capability:source-context-read:v1`;
- [`test-executor-trigger-status.v1.schema.json`](schemas/test-executor-trigger-status.v1.schema.json)
  with `$id` `urn:awp:schemas:005:capability:test-executor-trigger-status:v1`;
- [`artifact-ci-read.v1.schema.json`](schemas/artifact-ci-read.v1.schema.json)
  with `$id` `urn:awp:schemas:005:capability:artifact-ci-read:v1`.

The prose below defines behavior, authority and recovery. The schemas define
the exact JSON property names, bounds and conditional request/result shapes.

Resolution remains server-owned:

```text
workspaceId
+ projectId
+ environment scope
+ capability key and exact contract version
+ logical role
→ one compatible published Binding/Profile/Connection chain
```

All three roles plus one published compatible Suite Binding are required for
derived `capabilityMode=FULL_QA`. Missing or incompatible automation
configuration returns `MANUAL_ONLY` with stable configuration reasons. A
transient unhealthy provider preserves `FULL_QA` and changes the separate
`liveAvailability` to `DEGRADED` or `UNAVAILABLE`; only
`FULL_QA + AVAILABLE` permits launch. None of these states blocks the existing
manual Session flow.

## 2. Common trusted context and serialization boundary

Core supplies every operation a non-serializable trusted execution context
derived after current authorization:

```text
workspaceId + projectId
actor and authorization-basis refs
correlationId + causationId
classification decision
exact Binding/Profile/Connection/Mapping refs and digests
effect idempotency key for pipeline.trigger
deadline/AbortSignal and safe telemetry context
```

The browser, QA request body, model and provider response cannot choose or
replace these values. Public request bodies may contain only provider-neutral
domain selectors and immutable refs already authorized in the current Project.

Every operation follows these rules:

- objects are closed and versioned; unknown trust-boundary fields fail;
- external IDs are opaque strings scoped by the trusted Connection/Profile;
- provider display values and URLs are diagnostic only and are never identity
  or authorization;
- timestamps are RFC 3339 UTC and digests are canonical
  `sha256:<64 lowercase hex>`;
- response provenance names the observation kind/time and safe content hash;
- raw HTTP response, headers, token, unrestricted source text, environment
  variables, job log and artifact bytes do not cross a JSON result boundary;
- trusted configuration pins come from Broker context, not copied from a
  provider document.

## 3. `source-context.read@1.0.0`

This capability reads a bounded source/build selector allowed by the immutable
Profile. It does not grant general repository browsing.

### 3.1. Common selector

```text
SourceContextSelector = {
  sourceKind: MERGE_REQUEST | COMMIT | BUILD,
  sourceRef: opaque project-scoped reference,
  expectedRevision?: opaque revision commitment
}
```

The Profile maps the selector to one numeric provider project and exact API
dialect. Callers cannot supply provider base URL, numeric project ID, token,
arbitrary ref/query, file path or raw API route.

### 3.2. `merge-request.read`

Request:

```text
sourceKind = MERGE_REQUEST
sourceRef
expectedRevision?
```

Response is a bounded `SourceContextObservation` containing the opaque MR ref,
state, source/target revision commitments, canonical head commit, optional
allowlisted build refs, observed-at time, external revision token and sanitized
content hash. Title/description text, diffs, repository files and arbitrary MR
attributes are excluded unless a separately versioned classification policy
explicitly adds a bounded field.

### 3.3. `commit.read`

Request contains one opaque commit selector. Response contains canonical commit
digest, parent commitments when required by the Suite target contract,
observed-at time, external revision token and sanitized provenance. It is not a
repository tree/blob read capability.

### 3.4. `build.read`

Request contains one immutable build selector allowed by the Suite/Profile.
Response contains the normalized build identity/digest, producing source
commit, lifecycle/availability observation and safe provenance. It does not
stream build content or trigger a pipeline.

All three operations are `READ`. Their external text is untrusted and cannot
expand Tool Grants or become automatic model instructions.

## 4. `test-executor.trigger-status@1.0.0`

### 4.1. `pipeline.trigger`

`pipeline.trigger` is the only WRITE operation in the Feature 005 capability
set. The authorized QA layer prepares this provider-neutral request:

```text
PipelineTriggerRequest = {
  testSessionRef,
  automationAttemptRef,
  launchRequestCommitment,
  targetSnapshotRef + targetSnapshotHash,
  suiteBindingRef + suiteBindingHash,
  canonical allowed parameter values,
  opaque effect marker commitment
}
```

The request does not contain GitLab endpoint, numeric project, raw ref, job
name, variable/input name, secret, deploy environment, Profile/Connection
selector, shell fragment or raw artifact path. The Profile maps immutable Suite,
target and parameter values to one exact allowed provider request.

Success returns a `PipelineTriggerReceipt`:

```text
{
  externalPipelineId: opaque scoped ID,
  externalPipelineDisplayRef?: safe diagnostic,
  sourceCommit: immutable digest,
  observedState: QUEUED | RUNNING | TERMINAL,
  providerCreatedAt,
  observedAt,
  triggerRequestHash,
  effectMarkerHash,
  observationHash
}
```

A 2xx is accepted only after the receipt matches the exact project, marker,
target, Suite and request commitment. It is not a technical PASS and carries no
Session Outcome or QA Verdict.

### 4.2. Effect fencing and idempotency

GitLab trigger is not assumed to provide native idempotency. QA first claims
the unique Session/request-key hash and creates one immutable Attempt plus one
Core command/outbox record. The Connector uses the same effect marker for every
recovery observation.

```text
before durable effectInvocationStartedAt
  → exact lookup may run
  → a Profile-proven pre-effect transport failure may retry within budget

after durable effectInvocationStartedAt
  → no second trigger POST
  → pipeline.lookup only
```

Same request key/hash returns the existing Attempt/receipt. Same key with
another hash is a conflict. A QA infra retry or explicit HUMAN rerun always
creates a new Attempt, command, effect marker and external pipeline.

### 4.3. `pipeline.read`

Request contains the scoped opaque external pipeline ref already pinned to one
AutomationAttempt plus expected target/Profile commitments. Response is a
monotonic `PipelineObservation` containing:

- opaque pipeline and allowlisted job refs;
- canonical source commit/build and provider lifecycle state;
- queued/started/finished timestamps and durations when present;
- terminality, provider revision/updated token and observation hash;
- safe result-descriptor locator only after exact result-job policy matching.

Webhook payload fields never substitute this read. A provider `success` state
does not imply normalized `PASS`; terminal technical outcome comes only from
the exact validated machine-result contract.

### 4.4. `pipeline.lookup`

Lookup input is server-derived from the pinned Profile and original command:

```text
{
  effectMarkerHash,
  expected source commit/ref commitment,
  bounded provider creation window,
  original triggerRequestHash
}
```

It returns a closed lookup result:

```text
EXACT_ONE { receipt }
ZERO      { observedWindow, consistencyEvidence }
MULTIPLE  { safe match commitments }
```

`ZERO` is not `PROVEN_ABSENT` and never authorizes a new trigger after the
invocation marker. After the configured lookup-consistency window, `ZERO` and
`MULTIPLE` become visible `AMBIGUOUS`/`INCOMPLETE` recovery facts. Only
`EXACT_ONE` may attach a pipeline receipt to the original Attempt.

### 4.5. Status versus technical result

The exact machine result normalizes only to:

```text
PASS | ASSERTION_FAILED | INFRA_FAILED | TIMEOUT | CANCELLED | INCOMPLETE
```

It includes schema identity/version/digest, exact pipeline/job/source/target/
Suite/environment commitments, duration, optional closed infrastructure code,
artifact descriptor commitments and content hash. Unknown schema, missing
result, scope mismatch or checksum mismatch is `INCOMPLETE`, never PASS.

The QA retry policy is outside the Connector. It may create at most one new
Attempt only for `INFRA_FAILED` plus an exact allowlisted deterministic code.
Assertion, unknown, policy, auth and second infra failures do not auto-retry.

## 5. `artifact.ci-read@1.0.0`

### 5.1. `artifact.metadata`

Input contains an authorized AutomationAttempt ref, its pinned external
pipeline/job refs and a logical artifact key allowed by the Suite/Profile. It
does not contain a raw URL or caller-chosen provider path.

Output is a safe `CiArtifactDescriptor`:

```text
{
  descriptorId + descriptorHash,
  owner WorkItem/Session/Attempt refs,
  externalPipelineId + externalJobId,
  logical artifact kind,
  opaque provider locator commitment,
  file name/media type/size,
  checksum and checksum source (`CONNECTOR_CONTENT_SHA256` for the pinned
  machine-result source, `MACHINE_RESULT_MANIFEST` for detached evidence),
  classification,
  createdAt + expiresAt/availability,
  source Profile refs and provenance hash
}
```

The platform creates or resolves a same-scope Core ArtifactReference from this
descriptor. An external job/pipeline ID or raw provider URL is never sufficient
authorization.

### 5.2. `artifact.stream`

Input contains the authorized Core ArtifactReference/descriptor ref, exact
descriptor hash, expected checksum/size/classification and current trusted
authorization context. The Connector resolves the opaque locator using the
original immutable Profile.

The response is a bounded byte stream plus verified media type, size, checksum
and availability metadata. It is not embedded in a JSON event, command, audit
record or model prompt. Checksum mismatch, expiry, classification denial,
foreign scope, locator drift or provider redirect outside the Connection
allowlist fails closed before bytes reach the caller.

Neither artifact operation writes GitLab or mutates an Attempt. Raw artifacts
remain provider-authoritative; only metadata, checksum, availability and audit
lineage persist locally.

## 6. Webhook and reconciliation infrastructure boundary

Webhook ingress is Connector infrastructure, not a fourth Pack-callable
capability. The exact Profile declares Pipeline/Job events, raw body limit,
content type, Standard Webhooks HMAC-SHA256 mode, replay/dedupe horizon and
numeric provider project scope.

Processing order is mandatory:

```text
size/content type
→ exact Connection/Profile route
→ raw-byte signature and freshness
→ delivery identity + body hash
→ project scope resolution
→ durable receipt/inbox
→ safe routing hint
→ asynchronous pipeline.read
```

Same delivery ID/body is replayed idempotently. Same ID with a different body is
a security conflict. Duplicate/out-of-order events cannot reduce canonical
state directly, and bounded polling repairs a lost event through the same
`pipeline.read` operation.

## 7. GitLab adapter boundary

Only the GitLab Connector and its persistence adapter know:

- GitLab base URL, numeric project, exact API version/build and auth headers;
- GitLab ref, pipeline name, trigger input/variable names and job/artifact path;
- GitLab pipeline/job status DTOs, webhook payloads and pagination/rate headers;
- provider lookup consistency behavior and opaque artifact locator encoding.

QA owns Suite semantics, Session/Attempt lifecycle, retry/quarantine, Findings,
evidence review and human outcome. Core owns configuration resolution,
authorization, command/outbox/effect fencing, webhook inbox, ArtifactReference
and audit. Runtime composition is the only layer allowed to assemble the ports.

## 8. Prohibited operations and data

Connector `1.1.0` defines one scoped exception: `suite-result-example.read`
may read only `.awp/qa/result-example.json` from a specific GitLab project and
an exact 40-character commit SHA. It cannot read other repository files, use a
branch or tag, or write files. Validation of this example establishes only
schema compatibility; a result artifact from an actual pipeline run must be
verified separately. Connector `1.0.0` retains the original prohibition.
The successor is staged and must not be activated until its conformance and
security checks pass.

Version `1.0.0` intentionally has no typed operation for:

```text
pipeline.retry
pipeline.cancel
pipeline.delete
pipeline.create-arbitrary
repository.push
repository.file.read or repository.file.write
ci-config.read or ci-config.write
branch.create, branch.update or protected-branch mutation
variable.read, variable.write or secret.read
job.play, job.retry or arbitrary job selection
deployment.create, deployment.approve or production target
release verdict, Jira mutation or QA verdict
```

The following are forbidden in caller-controlled capability request data:

- endpoint/host, numeric provider project and Connection/Profile/Binding refs;
- access/trigger token, cookie, auth header or secret material;
- raw ref, provider job name, CI variable/input name, shell fragment or command;
- raw artifact URL/path, unrestricted log/source/artifact body;
- caller-supplied Workspace/Project/actor/classification authority;
- a model-selected grant, pipeline, Profile, retry, Finding classification,
  Session Outcome or Verdict.

Adding any such behavior requires a new reviewed capability/operation version;
it cannot be smuggled through optional fields or Profile data.

## 9. Conformance vectors

Every implementation of these contracts MUST prove:

1. all exact operation names resolve and every undeclared alias is rejected;
2. same Session/request key/hash yields one Attempt and at most one pipeline;
3. same request key with another hash is a conflict before provider access;
4. timeout after possible trigger effect uses lookup only and never a blind POST;
5. lookup exact-one recovers the original receipt, while zero/multiple remain
   visible ambiguity with no new trigger;
6. suite/ref/environment/parameter and production/deploy denial produces zero
   provider calls and zero secret materialization;
7. assertion/unknown/auth failure does not auto-retry; one allowlisted infra
   failure produces at most one new immutable Attempt/pipeline;
8. webhook duplicate/out-of-order/loss converges through authoritative read
   without overwriting an earlier Attempt fact;
9. provider success without the exact result schema/checksum is `INCOMPLETE`;
10. cross-project pipeline/job/artifact and foreign Profile/Connection refs are
    rejected before disclosure or bytes;
11. artifact metadata and streaming preserve checksum/classification/expiry and
    never treat a raw URL as authority;
12. technical PASS stops at sticky `REVIEW_REQUIRED`; no Connector, webhook,
    Hermes or service identity can sign outcome/verdict;
13. manual V1 fixtures remain valid unchanged and `MANUAL_ONLY` stays usable
    under GitLab outage;
14. secrets, raw provider bodies and restricted artifact content never enter
    contracts, commands, events, logs, metrics, audit or evidence reports.
