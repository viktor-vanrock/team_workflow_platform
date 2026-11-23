# Data model

platform_user_profiles: principal_id PK/FK HUMAN identity, display_name, username, created_at, last_authenticated_at. Directory registration alone grants nothing.

platform_role_assignments: principal_id + role_key primary key, role_key access-administrator, source LOCAL_BOOTSTRAP/LOCAL_FIRST_LOGIN/CORPORATE_GROUP/CORPORATE_FIRST_LOGIN, revoked_at, created_at. Each first-login bootstrap inserts once; revocation is never cleared by login or seed. A unique partial index on role_key for LOCAL_FIRST_LOGIN permits only one local assignment, including revoked rows. Historical CORPORATE_GROUP assignments remain valid without group checks in application-managed mode.

platform_administrator_bootstrap (core 225 / ADR-0015): one immutable row per database, singleton=true primary key, principal_id identity FK, source CORPORATE_GROUP/CORPORATE_FIRST_LOGIN, claimed_at. It is written atomically with the first corporate role and remains after revocation. Upgrade closes bootstrap for any historical corporate administrator, including revoked assignments. Local seed assignments do not claim it.

workspace_access_heads: workspace_id + principal_id PK, version monotonic, catalog-owned ALLOW role keys and known permissions determine managed grants; first adoption covers known catalog ALLOW roles while external unknown roles and DENY remain. Workspace memberships have existing ACTIVE/REVOKED lifecycle and row version.

platform_access_changes: UUID id, actor_id, target_id, workspace_id, request_key unique, request_hash, before_json, after_json, reason, created_at. Append only; response can be replayed exactly on identical request.

local_administrator_bootstrap (core 230 / ADR-0016): immutable singleton=true primary key, principal_id identity FK, claimed_at. First successful local HUMAN exchange writes this atomically with LOCAL_FIRST_LOGIN. Independent of corporate bootstrap.

local_administrator_seed_history (core 230): immutable archive of prior LOCAL_BOOTSTRAP principal_id/role_key/source/revoked_at/created_at, with retired_at and reason. Migration retires these historical assignments once and preserves working roles and data.

Use existing identities/workspaces/role_assignments/project_entitlements and immutable entitlement revision records. No nullable/global business scope. Local seed creates profiles for nine humans and no platform assignment.
