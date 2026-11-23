# UI contracts

- Local routes: `/` overview, `/qa/new` intake, `/qa/requests` explicit request list/detail, existing `/qa/queue`, `/projects`, `/projects/:id/onboarding`, `/projects/:id/evidence`, optional integrations and `/help`, `/developer`. Corporate `/pilot/*` routes retain existing dispatch and authentication.
- Session source: GET `/local/personas`; POST `/local/persona/exchange` with personaKey only. Permissions never inferred from a card label. Local persona metadata is explanatory only.
- Draft APIs unchanged: POST scoped `/qa/intake`; explicit POST `/intake-drafts/:draftId/qa-confirmation` with `idempotency-key: qa-ui:${draftId}`; GET same draft `/qa-status`. Snapshot preview cannot be edited in place.
- `QaWorkItemDetailProps`: optional initial view and create/open navigation callbacks, optional server permissions/project label; existing API context retained.
- `QaRequesterIntake`: optional onConfirmed(workItemId), projectLabel; context-bound component cancels pending reads on unmount.
- `QaConfirmedBacklog`: optional onOpen(workItemId), onCreate; displays authorized titles and states. Technical IDs/hashes in details.
- Request detail children are keyed by context/request; missing or revoked request has no active child actions. No auto-selection when user-selected ID is absent.
- Navigation has `aria-current`, forms have labels/helper text, feedback has live roles, tab/tabpanel semantics and keyboard support. Focus moves to main content after navigation and review/result after a form step.
