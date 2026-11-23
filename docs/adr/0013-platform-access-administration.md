# ADR-0013: Global access administration and application-managed workspace roles

Date: 2026-09-09. Status: Accepted by explicit user scope decision.

Amended 2026-09-10 by [ADR-0015](0015-first-corporate-administrator.md): first-login bootstrap and application-managed permissions replace the group requirement and first-user prohibition below. Other management/business scope boundaries remain applicable.

Local seed amendment: [ADR-0016](0016-first-local-administrator.md) replaces the fixed owner.local assignment with one global administrator selected by the first successful local login. Previous local seed assignments are archived by core 230.

## Decision

The user requested a users/multiple-roles administration screen after corporate Keycloak login and explicitly chose a platform-level administrator across all workspaces. Introduce `access-administrator` in a separate global management plane. It can list people/workspaces and manage workspace memberships and role assignments. It does not authorize project business data, integrations, QA decisions or document content. Existing `ResourceScope` and workspace-role constraints remain unchanged.

Corporate identity is established only by the existing verified OIDC callback. New eligible humans enter a global directory without business grants. A configured Keycloak administrator group plus a durable platform assignment authorizes administration. The global role is shown with its corporate source and cannot be assigned through the workspace-role editor. No first-user or email/name heuristic bootstrap. Revoked global assignments are not silently reactivated.

Workspace roles are explicit, multiple, workspace-wide team assignments with exact project entitlements and classification ceilings. UI edits are atomic, version checked, idempotent and audited; DENY and unrelated permission sources survive. Revoked rights are rechecked for ongoing sessions. Existing exact domain approvals remain identity-based, including self-approval restrictions.

## Governance and migration

Constitution 2.0.1 → 2.1.0 adds narrowly scoped global management authority; project security boundaries are preserved. Add directory, platform assignments, managed access versions and immutable change journal tables. Backfill active human participants only; retired diagnostic accounts remain absent. Seed a global assignment for the existing local administrator identity; do not add test accounts or reset data.

Rollback: disable the new UI/module/administrative permission, retain audit and tables. No destructive down migration or role restoration from stale seed. Legacy corporate behavior remains default until explicit provisioning/platform policy is supplied.

## Validation

Verify pending first login, trusted-group bootstrap, stale/revoked/forged identity denial, global scope across two workspaces without business access bypass, multiple roles and live revocation, classification/DENY preservation, CSRF/step-up, concurrent edits/retry and upgrade/data retention. Actual Keycloak realm/client configuration is deferred by the user; use existing independent local OIDC fixture for conformance and document future host wiring.
