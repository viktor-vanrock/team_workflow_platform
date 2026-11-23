# Data model

- Identity remains stable; role is independent of person and project.
- RoleAssignment live roleKey becomes system-administrator or reader; permissions remain explicit, validity/revocation/scope and classification limits remain authoritative. row_version changes on migration.
- Historical role keys normalize for compatibility but do not confer permissions alone. Existing events, approvals and evidence are not rewritten.
- SessionProject: projectId, projectKey, permissions, operational state. Session workspace has union navigation permissions plus explicit workspace grants. No UI-selected working project.
- WorkspaceSubject: projectId/projectKey, kind WORK_ITEM|CANDIDATE|DRAFT, id, human-readable title, status. Derived from authorized persisted resources, not invented data.
- Entity URL determines resource scope; creation form owns a temporary project choice. Workspace list filters never change another page's scope.
