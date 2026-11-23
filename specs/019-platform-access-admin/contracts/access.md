# Access administration HTTP contract

2026-09-10 / ADR-0015: the first verified corporate callback on a fresh installation atomically claims `access-administrator`; later users remain pending. Groups are not used in application-managed mode. `access/me` reports an active platform administrator as ACTIVE even before workspace assignment. Read-only global role sources include CORPORATE_FIRST_LOGIN; existing CORPORATE_GROUP sources remain historical provenance. No browser/API field can choose the bootstrap recipient.

GET /api/v1/access/me — verified own identity, platform permissions and own workspace memberships/roles. Pending humans allowed; never lists other people.
GET /api/v1/access/users?q= — global users.read; bounded search and directory with named memberships.
GET /api/v1/access/workspaces — global users.read; workspace metadata and domain role catalog.
GET /api/v1/access/users/:principalId — global users.read; named assignments, versions, read-only global role source, recent history.
PUT /api/v1/access/users/:principalId/workspaces/:workspaceId — global workspace-roles.manage plus fresh step-up; {roleKeys: string[], classificationCeiling: PUBLIC|INTERNAL|RESTRICTED|CONFIDENTIAL, expectedVersion: number, requestKey: UUID, reason: string}. Atomic replace of managed role set, empty set revokes membership. Return persisted access state/version. Unknown roles/workspaces/classification →400/404; no authority→403; stale version or mismatched request-key payload→409.

Local transport: existing guarded bearer identity; no client authoritative roles. Corporate transport: existing opaque cookie/session, exact allowed origin, X-CSRF-Token and fresh step-up. Global role cannot be edited here. No raw issuer groups/tokens/secrets in response or journal. DOM renders names as text.

Local first login (ADR-0016 / core 230): POST /local/persona/exchange validates the selected existing HUMAN, optional workspace selector and token issuance before atomically claiming the single local global role. The response includes current platform permissions, and the directory reports source LOCAL_FIRST_LOGIN. GET /local/personas, step-up and project selection do not claim it. Seed assigns no global role. Repeated/concurrent login and revocation never choose a replacement.
