# Mattermost and Hermes intake operations

This runbook covers Feature 004 in the `qa-jira-mattermost-local` contour and the optional approved non-production contour. Production delivery and production validation are denied by this release.

## Public bootstrap and OIDC continuation

`/awp create` is a static, text-only bootstrap. It ignores Mattermost actor, team, channel, trigger, token and `response_url` fields and returns the single configured first-party OIDC continuation. It has no Connector Connection or credential and must create no receipt, audit, intent or product state.

Change the continuation only through a versioned configuration change. Re-run `corepack pnpm verify:004:governance`, contract tests and the US1 checkpoint after a change. LOCAL continuations are loopback; DEVELOPMENT and TEST continuations require TLS. Authority begins only after canonical OIDC authentication and current authorization checks.

## Callback and outbound credentials

Use a distinct non-human bot credential per Workspace, Project and environment. Callback-enabled Profiles use two immutable ingress contracts: dialog submission and post action. `AWP_OPAQUE_INTENT` is LOCAL-only; DEVELOPMENT and TEST use the declared signed-proxy mechanism plus the AWP opaque intent.

Rotate a credential by creating a new secret version, validating the exact Connection/Profile binding, switching the active reference, and revoking the previous version. Never put a raw token, callback body, `response_url`, presentation plaintext or ciphertext in a command, log, audit event or evidence report. A credential fingerprint, bot identity, team or active channel may not be shared by two Projects.

## Presentation keys and retention

Callback presentation tokens are sealed with a project/environment-scoped AEAD key version. The key metadata, codec, AAD schema digest, payload/render/effect hashes, nonce, tag and `retainUntil` are immutable. The decrypt horizon must cover every capsule `retainUntil` plus the declared key-disable SLA.

Terminal delivery, consumption, invalidation and expiry erase capsule material in the same unit of work where required. The expiry sweep interval must not exceed the purge SLA, terminal purge SLA is zero, and active-store, WAL and backup retention must remain within the pilot metadata bounds. Validate these bounds with `feature-004-nonprod-metadata.mts` before enabling callbacks.

## Delivery ambiguity and recovery

Before durable `effectInvocationStartedAt`, a worker may reacquire its fenced lease and rebuild identical provider bytes. The invocation marker is written immediately before the provider POST. After that marker, never resend blindly.

Use only the reconciliation branch pinned by the Profile:

- one exact pending-ID/effect-marker match: record `DELIVERED`;
- zero, multiple or unsupported lookup: record terminal `AMBIGUOUS`;
- authentication, permission, channel, schema or policy failure: record `FAILED_FINAL` and update the existing Connection health with the closed reason;
- rate, server, timeout or network loss before the marker: stay within the bounded pre-marker retry budget.

Do not mutate Jira or QA source state during notification recovery. Run an explicit successful validation probe before returning a degraded Connection to `HEALTHY`.

## Health and evidence

The QA notification-health view is provider-neutral and shows delivery result, ambiguity and Connection health without provider bodies or secrets. For local evidence run:

```bash
corepack pnpm local:mattermost:up
corepack pnpm local:mattermost:status
corepack pnpm smoke:004
corepack pnpm trace:004
corepack pnpm verify:004
```

Inspect `reports/004-mattermost-hermes-intake/final-gate.json`. A local release requires `status: PASS`, production `DENIED`, and optional live Mattermost/model results reported honestly as `PASS` or `SKIPPED_GATED`.

## Local cleanup and reset

Normal cleanup is non-destructive:

```bash
corepack pnpm local:mattermost:down
```

Use reset only for disposable LOCAL fixture data:

```bash
corepack pnpm local:mattermost:reset
```

The command refuses non-local contours and prints the exact Docker volumes it removes. Never use reset against DEVELOPMENT, TEST or any shared environment.
