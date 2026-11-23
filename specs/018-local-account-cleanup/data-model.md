# Data model

No schema changes. `Identity` stays global and may be referenced by history. Each `WorkspaceMembership` and `RoleAssignment` requires a workspace ID; assignment may narrow to a project. No global resource scope exists.

Active catalog has nine HUMAN principals plus worker SERVICE. Public login options contain HUMAN only. Retired `limited.alpha` (…004) and `outsider.delta` (…009) leave the catalog; stable identifiers remain usable for migration/history assertions.

Upgrade transition: current project entitlement → appended REVOKE revision with seed actor/reason → deleted role assignments and memberships. Historical identities are retained if already present; not created on fresh installs. Seed marker 4 → 5, retry at 5 unchanged. Existing auditor retirement is preserved.
