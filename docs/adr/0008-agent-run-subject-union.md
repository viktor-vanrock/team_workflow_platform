# ADR-0008: Exact subject union for pre-acceptance Agent Runs

**Status:** Accepted

**Date proposed:** 2026-08-31

**Date accepted:** 2026-09-01

**Partially supersedes:** ADR-0005 Decision 1 only, replacing the Work Item-only
Agent Run subject clause. All other ADR-0005 decisions remain active.

## Context

ADR-0005 Decision 1 originally required every Agent Run to pin immutable `workspaceId`,
`projectId`, and `workItemId`. Feature 004 must support guided intake and Candidate assessment
before Jira accepts a request, when no Work Item is allowed to exist. Reusing a fake Work Item
would violate Jira authority; attaching a Draft mutation to an unrelated Candidate/Work Item would
weaken exact scope and audit; calling model-backed Hermes work outside Agent Run would bypass the
mandated grant/audit boundary.

The original Feature 004 wording anticipated Candidate subjects but omitted Draft, even though
US-001 invokes Hermes while editing a Draft. The planning update records the closed union
explicitly. This accepted ADR and Constitution 2.0.0 now make that union normative and partially
supersede only the Work Item-only subject clause of ADR-0005 Decision 1.

## Decision

1. Replace mandatory `workItemId` as the only Agent Run subject with one closed exact subject union:

   ```text
   DRAFT     { draftId, revision, contentHash }
   CANDIDATE { candidateId, sourceObservationVersion, contentHash }
   WORK_ITEM { workItemId, resourceVersion, contentHash }
   ```

2. Exactly one branch is populated. Every branch remains scoped to immutable `workspaceId + projectId`, and both the stored subject snapshot and every tool target must match that scope.
3. Draft/Candidate runs remain pre-acceptance proposals. They cannot create a Work Item, Jira issue, SLA/WIP state, ApprovalDecision, verdict, accepted priority or queue order.
4. The per-run Tool Grant remains the intersection of Hermes SERVICE authorization, SkillDefinition allowlist, initiating HUMAN current authorization, exact subject/configuration scope and classification.
5. Subject version/content drift invalidates pending recommendations/actions and requires a new input fingerprint or Run.
6. Existing Work Item Agent Runs remain valid without reinterpretation.

## Consequences

- Guided intake and Candidate triage use the same Agent Runtime, grant, prompt and audit boundary as accepted Work Item assistance.
- Persistence needs nullable `draft_id`, `candidate_id`, and `work_item_id` with a closed exactly-one check plus same-scope foreign keys.
- APIs accept only the closed subject union; clients/models cannot invent subject kinds.
- Feature 004 must add Draft/Candidate isolation, staleness, replay and prompt-injection tests.

## Rejected alternatives

- **Create a provisional Work Item:** violates Jira authority and Candidate non-acceptance.
- **Always create a Candidate for manual intake:** manufactures discovery provenance and still does not make Draft mutation an exact Candidate action.
- **Run Hermes outside Agent Runtime:** bypasses immutable grants, versioned skills, idempotency and audit.
- **Disable Hermes until Jira acceptance:** fails the guided intake purpose and Feature 004 scenarios.

## Compatibility and migration

The change is additive for runtime data. Legacy Agent Runs populate `WORK_ITEM`; new constraints are introduced expand-first and validated after backfill. No accepted Work Item, Approval or Jira binding changes.

Constitution VI previously said each Run was isolated by Workspace, Project and Work Item, so
acceptance required a constitution `MAJOR` amendment replacing the Work Item-only phrase with the
closed exact subject union above. Governance reserves MAJOR for an incompatible weakening,
removal or redefinition of an active invariant; expanding a Work Item-only subject to
pre-acceptance subjects is a redefinition even though the replacement remains closed and more
precisely scoped. Human review on 2026-09-01 accepted this ADR and Constitution 2.0.0, satisfying
the Feature 004 governance gate.

**Migration impact:** `N/A (pre-implementation)` for the constitutional change itself. If Agent Run storage is implemented before rollout, the data migration follows the expand-first compatibility sequence below.

## Rollout and rollback

Rollout is disabled by default. Under this accepted ADR and Constitution 2.0.0, implementation
adds nullable Draft/Candidate subject columns and same-scope foreign keys, backfills every
existing Run as `WORK_ITEM`, validates the exactly-one constraint, deploys readers compatible
with all three branches, and only then enables creation of Draft/Candidate Runs per
SkillDefinition.

Rollback disables new Draft/Candidate Run creation first, drains or terminally cancels their pending work without external effects, and retains immutable audit/results. The schema remains expand-compatible and existing Work Item Runs continue unchanged; no historical Run is rewritten or deleted. A later contract rollback removes the new branches from active composition only after no pending Draft/Candidate Run remains.

## Compliance checks

- Exactly one subject branch and same-scope foreign keys at database and domain layers.
- Draft/Candidate Runs cannot obtain Jira mutation, ApprovalDecision, verdict, queue-order or production grants.
- Same request key/different subject snapshot is a conflict.
- Cross-project subject/tool/prompt attempts are denied and audited.
- Source revision drift marks results stale before read/use.

## Related documents

- [Constitution](../../.specify/memory/constitution.md)
- [ADR-0004: Workspace and Project Entitlement](0004-workspace-project-entitlement.md)
- [ADR-0005: Hermes coordinator and exact Approval](0005-hermes-coordinator-approval.md)
- [Feature 004 specification](../../specs/004-mattermost-hermes-intake/spec.md)
- [Feature 004 plan](../../specs/004-mattermost-hermes-intake/plan.md)
