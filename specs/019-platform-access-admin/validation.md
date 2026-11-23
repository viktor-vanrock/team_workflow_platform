# Validation — 019 Platform access administration

Date: 2026-09-09. Spec Kit feature directory: 019-platform-access-admin. User explicitly selected platform-wide access administration; real corporate issuer/client ID are deferred. No OpenSpec artifacts were used.

## Requirements and implementation

- Requirements checklist: 16/16 passed. ADR 0013 and constitution 2.1.0 record the platform authority exception without widening business ResourceScope.
- Multiple workspace roles: catalog by domain, ALL_PROJECTS assignments, explicit classification, membership revocation, live authorization and identity-based self-approval prohibition.
- Management: separate durable platform role, trusted local/corporate identity adapters, current grant checks, CSRF/step-up, strict command shape, version conflicts, idempotency and immutable change history.
- Corporate: verified code/PKCE callback registers a named pending identity only; configured admin group plus durable platform assignment required; revoked global assignments do not reappear on login.
- UI: named directory, multiple roles and workspaces, history, pending login state, accessible selectors, explicit conflict reload, draft preserved across step-up, local permission refresh. Role-level access checks use actual persisted assignments.

## Executed checks

| Check | Result |
|---|---|
| New platform persistence/security scenarios | 6 passed: multi-role union, live revoke, domain separation, DENY preservation, concurrent editors/replay, self-approval prohibition and registration snapshot refresh |
| New corporate HTTP/OIDC scenarios | 4 passed: real signed tokens, pending login, directory boundary, CSRF/origin/step-up, grant/revoke and trusted admission |
| Request-bound local authentication | 1 passed; existing retired/service JWT checks 4 passed |
| Existing corporate identity/session checks | 18 passed |
| Affected unit/integration regression run | 48 passed; optional container scenarios were then enabled explicitly |
| Documentation/runtime/container checks | 13 passed; foundation migration checks on both PostgreSQL images subsequently passed (2) after updating the old migration count assertion |
| Shared team/new-project regression | 4 passed across the final shared-team rerun and registration suite |
| Browser admin + 016/017 regression | 17 passed |
| Root TypeScript | Passed |
| Root ESLint | Passed; latest follow-up files checked separately |
| Architecture | 24 projects accepted, no deep imports/cycles/dynamic runtime loading |
| Web production build | Passed |
| Formatting and git diff whitespace | Checked for changed implementation files |

## Issues discovered and resolved

1. Revoked legacy membership could tie a replacement membership version; replacement now exceeds every prior version.
2. Local seed persona caps prevented newly assigned roles; live DB policy now determines QA, documentation, queue and session access.
3. Separate Nest enhancer/provider instances could lose verified authentication metadata. Evidence is keyed by request object across guard instances; failed verification clears it and copies of a request cannot reuse it.
4. Global ProblemDetailsFilter removed domain-specific conflict/step-up messages. A controller-scoped allowlisted filter preserves only safe access errors; corporate HTTP tests include the global filter.
5. Concurrent SERIALIZABLE project registration must restart when team roles change; workspace version advancement prevents materializing grants from an old team snapshot.
6. Existing legacy membership test expected complete login rejection. The new intentional pending state has no projects or permissions and still denies business API access.

## Live stand

Historical rollout below predates core 230. The current local first-login role and deployment results are recorded in [local-first-login-validation.md](local-first-login-validation.md); owner.local is no longer preassigned the global role.

Existing Docker project awp-local-pilot-dev was upgraded through tools/local/pilot-cli.mts up with no volume reset. Web: http://localhost:55173/admin/users. Existing owner.local (Администратор · 1) has the platform role. There are still nine human login options and one internal worker; retired accounts remain unavailable.

Read-only live browser/API coverage and protected-write denial results are recorded in live-access.json. Visual review: admin-live.png. Business retention hashes/counts are recorded in data-retention.json: 4 documents, 6 work items, 15 document history entries, existing audit rows, identities, retained entitlements and retired-user absence are preserved.

Final deployed verification passed for all nine human accounts. The global directory returns 200 for owner.local and 403 for the other eight. After fresh local step-up, a protected write attempting to put the platform role into workspace roles returns ACCESS_ROLE_INVALID (400) for owner.local and PLATFORM_ACCESS_DENIED (403) for everyone else. No live grants were changed by these probes. Successful writes, revocation and rollback are covered against disposable PostgreSQL databases. All twelve final retention comparisons passed, including all 74 pre-existing audit rows. The final admin browser rerun passed all three scenarios after the last UI change. All 19 implementation tasks are complete; no extension hooks are configured.

Corporate Keycloak itself is not connected. The application path and verified OIDC flow are implemented and tested against the local fixture; final realm/client/mappers/groups/secret ports are documented in docs/deployment/corporate-access.md for later deployment.
