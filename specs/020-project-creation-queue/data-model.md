# Data model

No schema changes. Project registration command: key (2–32 uppercase A-Z, digits, underscore, hyphen), name (nonempty ≤256), ownerIds business/technical/qa/security/escalation as active HUMAN principal UUIDs, criticalityKey STANDARD in UI, dataClassificationKey canonical four values, nonempty reason, Idempotency-Key. Existing backend persists the unique responsible principal set, DRAFT/MANUAL_ONLY onboarding and team entitlement revisions atomically.

RegistrationOptions: schemaVersion 1, workspaceId, owners {id, displayName, username?}, criticalities and classifications {key,label,description}. Scope and current role checked server-side, private/no-store.

Queue pending display item: stable project+subject key, title, project label, work status and href. Calculated row retains original entry/order token; pending row has no order command. No synthetic queue entry or priority is persisted. Summary totals = server-visible calculated total plus unique pending work items, after full paged snapshot is loaded.
