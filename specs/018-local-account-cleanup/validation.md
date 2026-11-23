# Validation — 018 local account cleanup

Date: 2026-09-09. Branch: `codex/workspace-wide-flow`. Implemented via Spec Kit; no OpenSpec. Existing uncommitted features retained.

## Implementation

Nine HUMAN login options; internal seed has ten active principals including worker. `limited.alpha` and `outsider.delta` removed from runtime catalog and fake IdP allowlist. Human exchange/step-up/project-selection rejects retired/service keys with 403. Previously issued signed retired tokens fail guard validation with 401. Service token verification remains functional.

Seed v5 appends immutable REVOKE entitlement revisions, deletes retired memberships and role assignments, and retains historical identity anchors. Fresh installation does not create retired identities. Upgrading v4 changes no retained entitlement content; earlier versions still receive prior team/role upgrades. Reader is labelled «Читатель».

RoleAssignment requires workspaceId and ResourceScope only supports WORKSPACE/PROJECT. Known administrator is permitted in its workspace and denied in the foreign workspace. Guides explain independent memberships/assignments across workspaces.

## Automated verification

- 48 distinct Vitest scenarios passed across `tests/unit/018`, `tests/integration/018`, features 015/016/017 DB suites, QA seed, local security, queue SLA denial and fake IdP tests. Initial new test fixtures were corrected: audit is append-only and retirement adds audit records; signed-session verification now uses a real local JWKS server rather than a mock resolving another dependency instance. Final four session cases passed separately.
- 14 Playwright browser scenarios passed (features 016/017): shared QA team, queue, breadcrumbs, Hermes and current role controls.
- Root TypeScript check passed; root ESLint passed and final session/smoke files passed focused lint.
- Architecture: 24 projects, no forbidden imports/cycles/dynamic loading. Web production build passed.
- Formatting and `git diff --check` verified.
- The legacy 001 acceptance matrix was adapted to current human accounts and merged permissions; its mutating live journey was not run against the user's working database. New live verification is read-only apart from session issuance.

## Existing local deployment

Updated using `node tools/local/pilot-cli.mts up`, preserving volumes. API/worker/web/fake IdP/mock/edge healthy.

[Live access evidence](live-access.json): all nine users exchanged sessions and logged into the real UI; both QA opened the common queue; expected project access ALPHA/BETA or ALPHA-DOCS; no API errors. Four human exchange attempts (two removed diagnostic users, retired auditor, worker) returned 403.

[Data retention evidence](data-retention.json): active humans 11 → 9; retired memberships 2 → 0, assignments 2 → 0, active entitlements 4 → 0. Worker remains SERVICE with one membership and role. Four documents, six work items and 15 document-history rows have identical content digests. All 70 prior audit records are unchanged; four revocation records were appended. Historical identity count stays 13, but only nine humans retain active access.

[Login screenshot](login-live.png) and [QA 2 queue screenshot](qa2-live.png) captured from the deployed UI. Repeated `pilot-cli.mts seed` completed successfully: exact post-upgrade snapshot unchanged, no account resurrection or additional audit rows.
