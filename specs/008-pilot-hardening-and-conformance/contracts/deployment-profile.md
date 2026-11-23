# Deployment profile contract v1

## Startup

Parse a secret-free immutable configuration revision; reject unknown fields and
conflicting legacy/canonical selectors. Validate schema/network/reference formats
before migration execution. Resolve published registry refs after controlled
migration/bootstrap and before listener readiness, worker dispatch or connector
I/O. Liveness may report process health; readiness requires complete validation
and matching API/worker digest.

Required dimensions: deploymentProfile, runtimeProfile, target environment,
compositionKey, deployment revision, workspace/project scope, exact published
bindings and identity/secret/signing/network/telemetry/evidence/model/recovery
policy refs. No local database/Redis/S3 default, persona, dev credential or seeded
signing key is accepted outside local/test. Infrastructure secret values never
enter the serialized configuration record.

| Condition | Result |
|---|---|
| Unknown or conflicting selectors | CONFIG_PROFILE_CONFLICT |
| Non-local fake/persona/dev reference | LOCAL_COMPONENT_FORBIDDEN |
| Missing pilot Jira/GitLab/Mattermost inventory | REQUIRED_CONNECTOR_MISSING |
| Non-production target cannot be proved | TARGET_SCOPE_DENIED |
| Untrusted endpoint/redirect/callback/origin | ENDPOINT_POLICY_DENIED |
| Missing input/unresolved secret ref | BLOCKED_INPUT |
| API/worker digest mismatch | DEPLOYMENT_DIGEST_MISMATCH |
| Unsupported provider dialect/auth | BLOCKED_UNSUPPORTED |
| Required artifact cannot be retained | EVIDENCE_SOURCE_INSUFFICIENT |

Non-local URLs require HTTPS, approved origin/path/method and certificate trust.
Reject userinfo, fragments, redirects, DNS rebinding, cloud metadata destinations
and unrestricted egress. Approved corporate private networks remain usable;
local fixtures have a separate explicit network policy. Apply size/deadline bounds.

## Identity

Reuse `(issuer, subject)` and authoritative scope resolution. Pin issuer, API
audience, JWKS/introspection origins, algorithms, required lifetime claims, skew,
maximum age, key-cache bounds and access-token discriminator. RFC 9068 and vendor
JWT profiles differ. ID tokens are not API credentials. Opaque access tokens need
authenticated introspection or an explicit unsupported result.

Login uses authorization code + PKCE, state/nonce and exact redirects. Select a
server session/BFF boundary with HttpOnly/Secure/SameSite cookies and CSRF checks;
provider tokens stay server-side. The browser never selects a corporate persona.
Group mapping is allowlisted/versioned. Current Workspace membership, Project
Entitlement, role, classification and profile scope still intersect.

Privileged step-up uses configured acr/amr/auth_time; refresh alone is not fresh
authentication. Revocation/logout invalidate session projections within approved
bounds, and effect guards recheck current rights. During OIDC/JWKS outage, only
known-key sessions still valid under policy continue. Unknown keys, expired tokens,
new login and unverifiable step-up fail closed; outage cannot extend expiry.

## Secrets and signing

Bridge existing scoped SecretResolverPort/ephemeral leases and allowed-use hashes.
Resolution binds purpose, service identity, scope, exact profile/connection,
opaque reference, cancellation and deadline. Values exist only during runtime use;
cross-purpose resolution fails. Never dump secret-store errors or lease metadata.

An approved mapping binds refs to namespace/mount/path/field and revision policy.
Separate connector read/write/webhook, test-account, artifact and signing rights.
Use approved workload identity, not root/dev tokens. Rotation that changes service
identity/permissions creates a new config revision and invalidates dependent
pending actions; do not silently reinterpret an approved operation.

Remote evidence signing reuses EvidenceManifestSignerPort, verifier and immutable
public-key resolver. Sign the exact canonical detached-JWS input, pin/verify the
returned key version, and retain historical public verification material through
retention/restore. Private keys remain in the signing service. Signer outage blocks
signature-dependent finalization while preserving draft/history work.

## Storage and telemetry

> Superseded for v1 by Feature 010/ADR-0009: artifact mode is `GITLAB_ONLY` only.

Historical contract text below allowed two modes. GitLab-only requires policy
acceptance, source scope, hashes and sufficient retention; required manual uploads
without a source block completion. Add a distinct corporate object-store adapter;
preserve local-only transport checks. Validate origin, credentials, size, checksum,
version readback, cancellation and authorization before returning locators.

Initialize actual OTel providers/exporters before modules; propagate correlation
and causation through durable messages, flush on shutdown and verify Collector
receipt. Metrics use bounded connector/capability/outcome/reason dimensions. IDs,
prompts, artifact locators and raw exceptions are forbidden metric dimensions.
Project health is a scoped query, not an unbounded metric label.

Redact in-process and in Collector. Canary checks inspect actual API/worker logs,
telemetry, audit and reports. Durable audit is independent of export. Export outage
degrades readiness and blocks new promotion; audit persistence failure blocks the
mutation. Bounded telemetry buffering must not stop manual workflow indefinitely.
