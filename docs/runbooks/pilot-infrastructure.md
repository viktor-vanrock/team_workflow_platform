# Feature 008: pilot infrastructure and corporate handoff

This runbook covers the non-production corporate deployment boundary. Local
engineering uses the isolated development contour in
[pilot-development.md](pilot-development.md); it cannot produce C1, N2, recovery,
shadow, or observed-pilot approval.

## Deployment assembly

Code review update, 2026-09-10: the code below establishes the startup, registration and
adapter boundary. `PilotNonLocalApiModule` also supports the explicit corporate
onboarding/session/evidence bundle described in
[corporate onboarding API](corporate-onboarding-api.md). It does not yet assemble
all QA/intake/queue controllers and domain worker handlers; T025 remains open.
The [deployment document pack](../deployment/README.md) provides fillable templates,
configuration ownership, and the bootstrap/promotion/rollback sequence.
See [the deployment checklist](pilot-deployment-checklist.md) for the exact missing
providers/entry points and [GitLab setup](gitlab-pipeline.md) for CI configuration.

API and worker use the same published `DeploymentPolicy`, the same initialized
PostgreSQL schema, and the same current runtime-configuration revision. A non-local
process must receive the explicit programmatic assembly consumed by
`bootstrapApi(..., nonLocal)` or `bootstrapWorker(..., nonLocal)`. Startup rejects
an absent assembly, a local composition, a non-`NON_PROD` environment, an
unpublished deployment, a stale configuration head, mismatched endpoint origins,
or anything other than exactly one current Jira, GitLab, and Mattermost binding for
each configured Project.

The supported corporate compositions are
`qa-jira-gitlab-mattermost-development` and
`qa-jira-gitlab-mattermost-test`. Database endpoint, OIDC issuer and
audience, connector endpoints, telemetry, artifact policy, model policy, network
policy, and recovery policy are immutable references in the deployment revision.
API and worker compare the complete deployment digest before reporting readiness.
Readiness remains down until migrations, configuration validation, registration,
and the initial maintenance probes have completed.
Those startup checks must not be interpreted as proof of a complete business
workflow; the full domain entry-point acceptance remains required under T025.

The `controlled-sandbox` adapter mode is available only to automated tests with
`NODE_ENV=test`, `NON_PROD`, and loopback disposable PostgreSQL. It never
accepts Mock Hub, raw object-store credentials, local signing keys, or a
production environment in a non-local deployment.

Schema versions, access migrations and first-login order are listed in
[upgrade and verification](../deployment/upgrade-and-verification.md). Corporate
access administration is available with session bindings and `VITE_AWP_AUTH_MODE=corporate`;
full QA routing remains part of T025.

## C1 handoff checklist

System owners submit one secret-free input package containing accepted immutable
revisions for IN-01 through IN-12 from
[pilot-inputs.md](../../specs/008-pilot-hardening-and-conformance/pilot-inputs.md).
The owner-facing questionnaire, package structure and corporate evidence bundle
formats are collected in
[pilot-integration-intake.md](pilot-integration-intake.md).
Before N2, the platform owner checks:

- one approved Workspace and Project, non-production provider scopes, Jira
  workflow/defect fields, GitLab project/ref/SHA/suite, and Mattermost team/channel;
- exact provider editions, versions, REST/webhook dialects, permissions, rate
  limits, timeouts, retry guarantees, and sanitized samples;
- OIDC issuer, audience, algorithms, JWKS, client and session policy, first-login
  administrator provisioning, offboarding delay, session lifetime, and step-up policy;
  group mappings apply only to the explicit legacy provisioning mode;
- Vault namespace and workload-auth method, purpose-scoped opaque secret refs,
  exact versions, rotation overlap, signing/verification policy, and owners;
- endpoint origins, certificate authorities, DNS/IP allowlists, callback routes,
  ingress strategy, telemetry backend, artifact retention, recovery target and
  fence policy;
- release image/configuration digests, scanner policy, initial cohort, approved
  baseline protocol, sample size, dates, sponsor, QA Lead, on-call, rollback target,
  and communication owner.

Run `pnpm verify:008:inputs -- --input <package>` first. The command validates
shape and scope only. N2 remains blocked until real-provider evidence is supplied
and `pnpm verify:008:integration -- --input <package>` records installed-provider,
identity, Vault, ingress, telemetry, fault, and independent effect observations.

## Secrets and rotation

Workload identity authenticates to Vault. Connector code receives only an opaque
reference and a short single-use lease. Mappings bind Workspace, Project, service
principal, exact profile/connection/policy revisions, and one purpose:
`CONNECTOR_READ`, `CONNECTOR_WRITE`, `CONNECTOR_WEBHOOK`, `TEST_ACCOUNT`, or
`ARTIFACT`. A write credential cannot satisfy a read or webhook request. Raw
material is consumed inside request construction, zeroed after use, and never
written to configuration, logs, telemetry, reports, queues, or database rows.

Rotate by publishing the new Vault version and configuration revision, validating
the new workload permission, then publishing a deployment that selects it. Keep
the previous version only for the approved overlap and active lease horizon.
Revocation or a stale mapping closes existing leases. Rotate webhook HMAC keys with
one active key and no more than two bounded verification-only overlap keys. Rotate
evidence signing keys by publishing public-key history before selecting the new
private key; historical signatures continue to resolve their original public key.
An outage or failed rotation keeps effects denied and readiness degraded.

## Ingress and network policy

Use native Jira/GitLab receivers or explicit `GATEWAY` plus `RECEIVER` deployments.
The Nest host preserves raw request bytes and applies body/header limits before
authentication. Jira validates its selected signed-body dialect and exact project;
GitLab validates Standard Webhooks delivery ID, timestamp, and HMAC over raw bytes.
Mattermost requires a CA-verified and pinned client certificate at the gateway plus
the original persisted, scoped, unexpired human intent. Forwarded certificate
headers are not source identity.

The gateway signs the unchanged body and canonical envelope. The receiver rechecks
the published policy, current binding/profile/connection heads, original expiry,
human/service authorization, and replay identity inside the receipt transaction.
Ingress accepts no unsigned fallback. Network transport denies DNS rebinding,
redirects, unlisted origins, private/link-local targets outside an explicitly
pinned policy, and methods not approved for the endpoint purpose.

## Observability and operation

Merge [otel-collector.corporate.yaml](../../infra/observability/otel-collector.corporate.yaml)
with the base Collector configuration. Mount server, workload-CA, exporter, and
backend-CA material from the approved secret delivery mechanism. OTLP receivers
require mutual TLS; the outbound exporter uses mTLS and the pinned backend origin.
Keep the debug exporter disabled. Telemetry contains correlation IDs, stable low
cardinality operation/status dimensions, and redacted provider errors. It must not
contain tokens, webhook bodies, evidence bytes, user content, Vault paths, or secret
references.

Alert on failed readiness, configuration-digest disagreement, expired capability
observations, ambiguous effects, dead letters, denied ingress spikes, telemetry
export failure, cohort expiry, and suspension. The named on-call follows
[pilot-operation.md](pilot-operation.md). Recovery follows
[pilot-recovery.md](pilot-recovery.md), uses a disposable approved target, fences
the old runtime, verifies signatures/artifacts/audit continuity, rereads providers,
and measures the approved RPO/RTO.

## Verification order

The local release check is `pnpm ci:008`. Its PASS is recorded in `local.json` and
proves the development contour, PostgreSQL 17/18 migrations, compatibility,
security fixtures, browser flows, recovery fixture, smoke, types, lint, build, and
trace. Corporate readiness is a separate report and remains `BLOCKED_INPUT` until
the following evidence passes in order:

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

Shadow must show zero independent provider business writes. Activation remains an
exact human-approved Project action. Review requires the actual elapsed window,
minimum sample, independently observed guardrails/effects, QA Lead and sponsor
decisions. Missing evidence stays `BLOCKED_INPUT`; operators do not replace it with
development fixtures or synthetic elapsed time.
