# UI/API contract

- GET workspace QA queue: existing AUTHORIZED_PORTFOLIO contract, canonical ordering and cursor generation; only authorized project entries and counts. Requires workspace queue.portfolio.read, project queue.project.read and appropriate classification/capacity rights.
- Local session project records include exact permissions. Client may discover sections from allowed union; server remains authoritative on every resource request.
- Requests and subjects aggregate authorized project endpoints. Every item carries stable project+entity reference. An inaccessible project contributes no hidden identifiers or counts; errors are reported without exposing resources.
- Request detail route retains explicit project and request identifier in URL. Login preserves valid destination. Parent links open common list/queue; current breadcrumb occurs once.
- New request chooses project within its own form. Global project selector is absent.
- Hermes selector shows title, type and project. The API request uses selected kind/id/project; selection change clears stale proposals; empty/error states are distinct.
- Mutating controls require exact per-project permissions (queue order, request create/intake, execution, verdict, Jira action, integration configuration, suspend/resume). Direct forbidden routes never mount data-fetching content.
- system-administrator unifies previous owner/integration roles. reader unifies reader/viewer. Two different admin principals remain needed wherever independent approval is required.
