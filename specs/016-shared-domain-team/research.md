# Research

## Shared roles

Decision: existing workspace-level roles (`project_id NULL`) plus explicit `project_access_scope=ALL_PROJECTS` and `classification_ceiling_key`. Exact project entitlements remain authoritative. Materialize revisioned grants for new projects during registration; seed existing workspace projects for shared functional human personas.
Rationale: Core already intersects roles, membership and entitlement with DENY precedence. A wildcard authorization bypass would break constitution III.
Alternatives: duplicate role/person per project rejected by user; automatic access from membership rejected; new team/domain subsystem unnecessary for one shipped QA pack.

## Identity and upgrade

Decision: preserve existing principal UUIDs and legacy login keys for compatibility; expose labels without project suffixes; add QA 2 with the same qa-executor role. Explicit fixed seed ordinals prevent identity/role reassignment after removing a persona. Retire auditor live relationships and deny both exchange and old tokens; retain historical identity where immutable records reference it.
Rationale: earlier seeds derive role IDs from catalog order, so deleting an entry without stable ordinal mapping would corrupt associations.

## Project selection

Decision: authenticated session endpoint selects a requested project from authoritative current rights; return project options, same subject and token context. Use actual authorization policy for permissions rather than aggregating all ALLOW rows. Browser clears mounted project state/query on success and retains prior state on failure.
Alternatives: client-side arbitrary ID replacement rejected; logging in as another role rejected.

## Corporate mapping

Decision: optional explicit projectAccessScope ALL_PROJECTS with an empty projectIds list; retain exact workspace and role key allowlist and live per-project entitlements. Existing mappings unchanged; '*' remains invalid.

## Breadcrumbs

Decision: native anchors within a named navigation landmark; archive '/', project '/projects/{id}/onboarding' where readable (otherwise requests), section's canonical path. Current page aria-current, separators aria-hidden; no chosen project links to catalog.
