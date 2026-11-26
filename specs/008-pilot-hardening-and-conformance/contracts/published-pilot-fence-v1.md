# Published pilot fence V1

The current `FENCE` PilotRecord body contains exactly `schemaVersion: 1`, `mode`,
`environment: NON_PROD`, `deploymentRef`, `cohortRef`, `runtimeInstanceId`, `startsAt`,
`expiresAt` and `revoked`. Exact refs contain `id`, `version`, `contentHash`. The fence
ref is the enclosing immutable record ID, version and hash, avoiding a self-referential
hash. The worker ID identifies an active worker runtime registration.

The referenced current `COHORT` record body is a `PilotCohortRevision` with its own
canonical `contentHash`; its enclosing record hash supplies the exact cohort ref. Scope,
project and principal membership come from that cohort. The effective window is the
intersection of both windows. Either revocation closes the fence. Multiple current
fence headers in one project fail closed, as do a stale cohort, an invalid hash or a
missing project. Each cohort project's exact onboarding ref must match either the
current active revision or its immediately preceding `SHADOW` revision. In the latter
case the active revision must be the exact result of a completed activation candidate
with a distinct step-up approver and consumed approval. Any other later revision
requires a new cohort revision.
Runtime also requires the project's `PILOT_ACTIVE` and operational
`ACTIVE` state, current HUMAN authorization, matching deployment and live worker lease.

The reviewed IN-10 `cohortRef` is `pilotCohortScopeHash`: the canonical SHA-256 of the
cohort body excluding `gateRefs` and `contentHash`. This pins the full cohort scope
before gate results exist. The complete cohort including exact gate refs is separately
bound to the publication candidate and distinct-human approval; execution rechecks all
four current verified gates and the reviewed scope.

The storage repository only supplies immutable records and CAS. It does not itself
authorize publication. A controlled, audited publication workflow is still required;
operators must not treat arbitrary writes to the underlying tables as approved policy.
