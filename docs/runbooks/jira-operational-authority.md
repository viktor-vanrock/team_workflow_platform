# Jira operational authority runbook

This runbook operates Feature 003 in `LOCAL` or explicitly attested `NON_PROD`. Production Jira targets and production credentials are not supported by this feature.

## Safe disablement

1. Disable the affected Connection/Profile effect lane; keep webhook inbox persistence and authoritative reads available when safe.
2. Stop new Jira writes before rotating credentials, changing mappings, or investigating ambiguity.
3. Preserve PostgreSQL commands, effect receipts, inbox rows, projections, cursors, approvals, and audit. PostgreSQL is the only delivery authority in v1.
4. Never delete or manually rewrite a pending command to make it retry. Resume only after the original pinned configuration and authorization are still valid.

## Authentication failure and rotation

- `401` marks the Connection `AUTH_BLOCKED`; `403` is a terminal permission failure for the affected operation. Neither is blindly retried.
- Confirm that logs and reports contain only a secret reference or redaction token. A raw token requires incident handling and revocation.
- Rotate the service credential in the secret manager, update the referenced secret version, run the revocation check, then rerun metadata preflight and the read-only least-privilege check.
- The service identity must not have global/project administration, issue deletion, workflow/field/user management, impersonation, or a personal PAT.
- Re-enable writes only after a fresh discovery snapshot and exact Profile validation succeed.

## Dynamic webhook renewal

- Monitor expiry, renewal lead time, registration identity, verification mode, retry horizon, and dedupe horizon from the pinned metadata package.
- Renew before `expiry - renewalLeadSeconds`; never shorten dedupe below the provider retry horizon.
- A renewal failure disables reliance on webhook freshness but does not authorize projection changes from webhook payloads. Reconciliation remains the recovery path.
- After renewal, verify a signed/secret delivery, durable inbox ACK, duplicate handling, and authoritative re-read.

## Mapping or capability drift

- Unknown fields, statuses, transitions, issue/link types, or response schemas block only the affected Profile/binding with `MAPPING_REQUIRED` or normalized validation failure.
- Retain the last confirmed projection and mark freshness honestly. Do not infer a new normalized state from an unvalidated payload.
- Capture a sanitized discovery snapshot, publish a new immutable Profile version, validate/preview/dry-run it, and make a new explicit human decision for commands that can no longer use their pinned version.
- Never edit a published Profile in place or retarget an existing command/effect.

## Ambiguous effects

- A timeout after a possible create/link/update moves the effect to `AMBIGUOUS`; do not repeat the write.
- Search only by the exact durable effect marker, then authoritative-read every candidate and reconcile recorded sub-effect receipts.
- Zero exact matches may be retried only under the original idempotency identity and operation policy. One exact match is adopted. Multiple exact matches require operator resolution and remain non-automatic.
- Heuristic similarity is diagnostic only and never confirms an effect.

## Backlog, rate limiting, and freshness

The local `qa-jira-*` worker now enqueues durable per-binding reads when the last
confirmed read is at least 60 seconds old. The scheduler is bounded to 50 bindings
per pass, excludes bindings with a pending read, and selects only the published
LOCAL connection matching the configured Mock Hub endpoint. Webhook reads and
periodic reads use the same observation reducer and update the Work Item together.
Applied changes emit `work_item.operational.projection-updated` for queue refresh.
Unchanged successful reads renew the 120-second freshness window without appending
a projection revision. Failed reads retain their outbox entry with a 5–60 second
backoff, respecting a longer provider `Retry-After`, and expose a safe binding error.
The status tab reloads the platform projection every 5 seconds; its refresh button
does not itself issue a Jira read. See the [user guide](../user-guide/jira-status-sync.md).

- Honor `Retry-After` and the per-Connection rate budget. Prioritize command confirmations and webhook reads over background sweeps while retaining fair scheduling.
- Track inbox age, command age, reconciliation lag, cursor watermark, duplicate/out-of-order counts, and `freshUntil` breaches.
- A failed/partial sweep does not advance its durable watermark. Resume with overlap and periodically perform a full sweep.
- Freshness expiry is derived display state; it must not create a projection revision. Jira-owned values change only after authoritative confirmation.

## Conflict and recovery

- A stale expected token/value performs zero mutation, appends a visible conflict, refreshes Jira, and terminalizes the old command/approval.
- A new action requires a new typed intent, authorization basis, exact approval, and idempotency identity.
- On worker restart, reclaim delivery from PostgreSQL and reconcile any possibly-started effect before retrying.
- Recovery is complete only when the audit chain links human intent, approval, pinned configuration, transport attempt/sub-effects, authoritative read, projection, and generic/QA confirmation.

## Verification commands

Run `pnpm jira:nonprod:preflight` before any opt-in live check. Local recovery is exercised by `pnpm smoke:003`, `pnpm verify:003:quickstart`, and `pnpm verify:003`. Reports are written under `reports/003-jira-operational-authority/` and must remain free of credentials and raw provider payloads.
