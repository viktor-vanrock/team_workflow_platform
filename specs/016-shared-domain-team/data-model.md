# Data Model

- Identity: unchanged UUID/issuer/subject; display label separates person's number and QA function from project.
- RoleAssignment: existing workspaceId, principalId, roleKey, permissions, validity; add projectAccessScope SELECTED_PROJECTS (default) or ALL_PROJECTS. ALL_PROJECTS requires projectId NULL, ALLOW, explicit classificationCeilingKey. No wildcard permission.
- ProjectEntitlement: unchanged exact workspace/project/principal revision history and live projection. Registration takes valid ALL_PROJECTS human assignments joined with active membership, intersects validity windows, and emits grants with the assignment's classification ceiling.
- LocalSession: add projects [{projectId,projectKey}], retain actor, permissions, selected context. Project choice is a request selector and conveys no authority.
- CorporateGroupPolicy mapping: optional projectAccessScope ALL_PROJECTS; projectIds must be empty in this mode, nonempty for default SELECTED_PROJECTS. Both modes require exact role keys and workspace.
- Auditor retirement: no catalog/IdP entry, no active role/membership/entitlement; immutable audit/revisions retain historical identity. No generic audit service deletion.
