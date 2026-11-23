# Mattermost, ingress and Hermes contracts

## Connector manifest

The statically composed Mattermost Connector advertises these Feature 004 keys:

| Contract | Operation | Broker effect | Purpose |
|---|---|---|---|
| `messaging.intake@1.0.0` | `intake.present` | `WRITE` | Render a versioned project-scoped guided-intake presentation after OIDC selection. |
| `messaging.notify@1.0.0` | `notification.send` | `WRITE` | Send a policy-approved template to a server-resolved logical target. |
| `messaging.callback@1.0.0` (optional) | `callback.present` | `WRITE` | Render one project-scoped presentation with 1–8 independently single-use opaque InteractionIntents. |

These outbound presentation/effect contracts do not authenticate inbound HTTP. Project-scoped dialog submissions and post actions are declared by `ConnectorIngressContract@1.0.0`, registered next to the Connector manifest, and dispatched through the generic ingress registry. The public `/awp create` bootstrap is not a Connector operation: it is a bounded stateless response with no Connection, credential, identity resolution or durable state. This preserves the current Broker `READ | WRITE` effect model without inventing an inbound write.

After OIDC login, the web API derives current authorization and issues separate project-scoped `WEB PROJECT_SELECT` intents. Consuming one resolves the exact project-scoped Connection/Profile/bot credential before any Mattermost read or send. There is no Workspace-scoped Connector registration or credential. Publication rejects cross-Project credential/bot reuse and active team/channel aliases.

## Ingress contract

Each declared route pins:

- one route kind and exact Connection family;
- accepted method, content type and maximum raw size;
- callback-only `AWP_OPAQUE_INTENT | SIGNED_PROXY_HMAC_PLUS_AWP_INTENT` authentication;
- freshness/retry horizon, clock skew and receipt retention;
- deterministic delivery-identity extraction;
- exact normalized-output and acknowledgement `SchemaRef { id, version, digest }` values plus Profile compatibility range;
- route/auth/replay combinations constrained as one closed union rather than independently selectable fields.

Processing order is mandatory:

```text
size/content-type
  → exact Connection-bound ingress-contract policy
  → constant-time transport authentication
  → freshness/delivery identity
  → bounded schema normalization (discard raw bytes)
  → durable receipt/inbox CAS with a safe normalized envelope
  → route-valid callback HTTP 200 acknowledgement
  → asynchronous project-scoped dialog/action/domain policy
```

The separate public bootstrap accepts only the exact `/awp create` form shape and returns deterministic ephemeral text containing one configured first-party OIDC URL. It ignores `user_id`, team/channel, token, trigger and `response_url`; it persists and audits none of them. After OIDC, `POST /api/v1/intake/mattermost/project-option-sets` performs the full current authorization query and issues one fresh project-scoped intent per option while invalidating the prior pending set for that session. `POST /api/v1/intake/mattermost/project-selections` consumes one exact intent and creates/replays Draft revision 1.

With a trusted callback gateway delivery ID, the first project-scoped receipt claims `(connectionId, transportKind, deliveryId)` and stores `bodyHash`; same ID/hash returns the prior acknowledgement and same ID/different hash is quarantined. Without such an ID, the exact project Connection-bound callback contract declares exact-body fingerprint attempt identity; a changed body is a different attempt and the separate InteractionIntent CAS remains the semantic replay boundary. An InteractionIntent token is never used as the transport delivery ID. The receipt is a project-scoped leased/recoverable inbox.

The sole V1 bootstrap command is `/awp create`. Bare root, `/awp status`, or unknown text is rejected or rendered as safe help and never receives implicit create/read semantics; a future status command needs a separately versioned public response and authenticated subject contract.

## Message request boundary

The Connector accepts a logical target, not a caller-selected Mattermost channel:

```text
PROJECT_CHANNEL { purpose }
PRINCIPAL_DM { principalId }
INTERACTION_RESPONSE { sourceInteractionIntentId }
```

The request pins `templateRef/version/hash`, schema-bound variables, classification/redaction decision, Profile/Connection/Binding refs, effect key and expiry. Arbitrary markdown, `channelId`, `response_url`, URLs, tokens and provider DTOs are rejected from API/Broker callers and from the durable Connector command payload. The Connector resolves the exact channel/post route from immutable Profile content and current membership. `INTERACTION_RESPONSE.sourceInteractionIntentId` is routing input for an existing delivery result; it is never confused with a newly presented action.

`callback.present` adds a separate ordered `presentation { actionInteractionIntentIds, actionSetHash }`; Candidate `CREATE | SNOOZE | IGNORE`, for example, is one command/post with three exact intents and capsules, not three effects. One idempotent projection UoW creates the `NotificationIntent` already linked to one Connector command, all same-scope InteractionIntents, their per-slot project-scoped AEAD capsules and the command/outbox row. A non-actionable NotificationIntent maps instead to exactly one `messaging.notify` command, so one notification can never fan out into both operations.

The durable callback command carries only source/action intent refs and immutable target/payload/render/effect commitments. An injected Core-owned presentation-materializer validates the matching unexpired intent, capsule/key version, NotificationIntent, command, Workspace/Project, actor/subject/transport/configuration, slot, target/payload/render hashes, effect-key hash and worker fence, then lends the Connector a one-shot non-serializable `SensitiveValue`. The Connector—not Core—builds the transient provider DTO; logging, tracing and HTTP body capture are suppressed, and any mutable byte buffers are cleared best-effort without claiming guaranteed Node/GC zeroization.

`AWP_INTERACTION_TOKEN_AEAD_V1` is a byte-level contract. Plaintext is the exact UTF-8 bytes of the opaque token string, with no Unicode normalization, trimming or base64 decoding; the historically named `nonceHash` is `SHA-256` of those plaintext bytes and is distinct from the AEAD nonce. Encryption is AES-256-GCM with a unique random 12-byte nonce per key version and a 16-byte authentication tag. The capsule stores nonce, tag and ciphertext separately; `ciphertextHash` is `SHA-256` of ciphertext bytes only.

AAD is exactly one instance of [`InteractionPresentationAadV1`](schemas/interaction-presentation-aad.v1.schema.json), serialized by RFC 8785 JCS and then UTF-8 encoded with no BOM or trailing newline. It closes over the immutable intent identity/scope/action/parameters/subject/actor/transport/configuration/authorization/token-hash/expiry/correlation fields and capsule ID, exact key version, NotificationIntent, slot, command, capability, effect/target/payload/render commitments and `retainUntil`. Mutable intent state/results, `aadHash`, ciphertext hash, AEAD nonce, tag and ciphertext are excluded. `aadHash` is `SHA-256` of those canonical AAD bytes, and both the schema digest and hash are verified before decrypt. The [test-only golden vector](examples/interaction-presentation-aead.vector.v1.json) must encrypt, decrypt and reproduce every byte/hash exactly in Core and Connector conformance tests.

The worker materializes and hashes exact provider bytes before durably recording `effectInvocationStartedAt`; a crash before that marker may reconstruct the same bytes. Once the marker exists, no second POST is permitted. The NotificationIntent records a Profile-matched closed reconciliation ref: pending-post ID or effect-marker lookup enters `LOOKUP_REQUIRED`, while `NONE_AMBIGUOUS` transitions directly to `AMBIGUOUS`. Before lookup, Core joins the exact command/fenced attempt that owns the invocation marker and requires byte-for-byte equality with its pending ID or equality with SHA-256 of its exact UTF-8 effect-marker bytes; cross-command/attempt selectors are rejected. V1 treats unsupported, zero or multiple matches as terminal `AMBIGUOUS`; exactly one match is `DELIVERED`. Only a future contractually proven `NOT_APPLIED` outcome may re-enable the same command. Capsule erasure is in the same PostgreSQL UoW as delivery, callback consumption, invalidation or terminal command state; expiry additionally has an unwrap-time guard and bounded sweeper. Re-presentation after erasure issues a replacement action set and invalidates the old intents.

## Agent and Tool Gateway boundary

`AgentRun` subject is a closed union `DRAFT | CANDIDATE | WORK_ITEM`. Every run pins one Workspace, Project, HUMAN initiator, Hermes SERVICE identity, Agent/Skill/rules/policy/prompt-template refs, PromptManifest fingerprint, model ref when used and an immutable grant-set hash.

Each grant is the intersection of:

```text
Hermes SERVICE authorization ceiling
∩ SkillDefinition allowlist
∩ initiating HUMAN current authorization
∩ exact subject/Project/Profile scope
∩ classification ceiling
```

Allowed Feature 004 effect classes are `READ_ONLY`, `PROPOSAL`, `DRAFT_MUTATION`, `NOTIFICATION_INTENT`, and an existing web `APPROVAL_REQUIRED` handoff. The model cannot execute Connector/Jira operations directly. Tool Gateway validates a closed action schema, reauthorizes both principals and exact scope, applies expected-state CAS, persists denied attempts, and returns a typed result.

## Failure and ambiguity

- `400`/schema, `401`, `403`, invalid channel/member or classification denial are terminal and degrade integration health.
- Local validation/materialization/scheduler throttling before `effectInvocationStartedAt` uses bounded Profile budgets. After the marker, V1 records `Retry-After` but treats `429`, `5xx`, timeout and connection loss as Profile-selected reconciliation uncertainty; none authorizes another POST.
- Timeout after possible post creation uses the pinned exact pending-ID/marker selector when lookup is supported; `NONE_AMBIGUOUS` or unsupported lookup ends directly in `AMBIGUOUS`. One exact match confirms delivery; zero or multiple matches also become `AMBIGUOUS` with no blind resend.
- Configuration drift before first invocation is terminal. Once an effect starts, recovery uses the original immutable pins and effect key only.
