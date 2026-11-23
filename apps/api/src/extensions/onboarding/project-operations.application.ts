import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import { assessProjectCapabilityMode } from "@awp/competency-qa/node";
import {
  type Approval,
  type CapabilityProbeResult,
  consumeAuthorizedProjectAction,
  createOnboardingRevision,
  createProjectResumeActionCandidate,
  type ExactRevisionRef,
  type ProjectActionApproval,
  type ProjectActionCandidate,
  type ProjectOnboardingRevision,
  type ProjectResumeActionCandidate,
  type ProjectScope,
} from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

import { bindingHead, bindingRevision, configurationFacts, contextFact } from "./binding-facts.ts";
import {
  type AdministrativeAuthority,
  appendOnboarding,
  auditAndEvent,
  authorizeAdministrative,
  command,
  currentAuthority,
  digest,
  lockOnboarding,
  type OnboardingRequest,
  ref,
  reject,
  same,
  validHash,
} from "./durable-http.ts";

export const PROJECT_OPERATIONS_HTTP_APPLICATION = "PROJECT_OPERATIONS_HTTP_APPLICATION";
type Disposition = Readonly<{
  dispositionId: string;
  workspaceId: string;
  projectId: string;
  incidentRef: string;
  onboardingRevisionId: string;
  outcome: "ACCEPTED" | "REJECTED";
  actorId: string;
  reason: string;
  createdAt: string;
  contentHash: `sha256:${string}`;
}>;
const actionRef = (a: ProjectActionCandidate) => ref(a.actionId, 1, a.contentHash);
const revisionRef = (r: ProjectOnboardingRevision) => ref(r.revisionId, r.version, r.contentHash);
const scopeArgs = (r: ProjectScope) => [r.workspaceId, r.projectId];
const permissions = {
  PROJECT_RESUME: "project.resume",
  BINDING_PUBLISH: "integration.publish",
  BINDING_RETIRE: "integration.publish",
  ONBOARDING_PILOT_ACTIVATE: "project.onboarding.activate",
} as const;

export async function saveOperationalCandidate(
  manager: EntityManager,
  candidate: ProjectActionCandidate,
) {
  await manager.query(
    "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7)",
    [
      candidate.actionId,
      candidate.workspaceId,
      candidate.projectId,
      candidate.kind,
      candidate,
      candidate.contentHash,
      candidate.createdAt,
    ],
  );
  await manager.query(
    "INSERT INTO project_operational_action_candidates(action_id,workspace_id,project_id,action_kind,target_ref,expected_onboarding_version,prerequisite_refs,initiator,reason,expires_at,created_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      candidate.actionId,
      candidate.workspaceId,
      candidate.projectId,
      candidate.kind,
      candidate.targetRef,
      candidate.expectedOnboardingVersion,
      JSON.stringify(candidate.prerequisiteRefs),
      candidate.initiator,
      candidate.reason,
      candidate.expiresAt,
      candidate.createdAt,
      candidate,
      candidate.contentHash,
    ],
  );
}
export async function loadOperationalCandidate(
  manager: EntityManager,
  scope: ProjectScope,
  exact: ExactRevisionRef,
): Promise<ProjectActionCandidate> {
  const rows = (await manager.query(
    "SELECT a.candidate_ref,a.candidate_hash,a.state,c.semantic_body,c.content_hash FROM platform_actions a JOIN project_operational_action_candidates c ON (a.workspace_id,a.project_id,a.id)=(c.workspace_id,c.project_id,c.action_id) WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3 FOR UPDATE OF a",
    [...scopeArgs(scope), exact.id],
  )) as {
    candidate_ref: ProjectActionCandidate;
    candidate_hash: string;
    state: string;
    semantic_body: ProjectActionCandidate;
    content_hash: string;
  }[];
  const row = rows[0];
  if (
    !row ||
    row.state !== "PENDING" ||
    !same(row.candidate_ref, row.semantic_body) ||
    row.candidate_hash !== row.content_hash ||
    !same(actionRef(row.semantic_body), exact) ||
    !validHash(row.semantic_body as unknown as { contentHash: string })
  )
    return reject("EXACT_ACTION_UNAVAILABLE", 409);
  if (Date.parse(row.semantic_body.expiresAt) <= Date.now())
    return reject("EXACT_ACTION_EXPIRED", 409);
  return row.semantic_body;
}
export async function consumeOperationalApproval(
  manager: EntityManager,
  scope: ProjectScope,
  candidate: ProjectActionCandidate,
  approvalRef: ExactRevisionRef,
  currentVersion: number,
): Promise<ProjectActionApproval> {
  const rows = (await manager.query(
    "SELECT subject,subject_hash,decision_state,effect_authorization_state FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
    [...scopeArgs(scope), approvalRef.id],
  )) as {
    subject: ProjectActionApproval;
    subject_hash: string;
    decision_state: string;
    effect_authorization_state: string;
  }[];
  const row = rows[0],
    approval = row?.subject;
  if (
    !row ||
    !approval ||
    row.decision_state !== "APPROVED" ||
    row.effect_authorization_state !== "AUTHORIZED" ||
    !same(ref(approval.approvalId, 1, digest(approval)), approvalRef) ||
    row.subject_hash !== candidate.contentHash
  )
    return reject("EXACT_APPROVAL_REQUIRED", 409);
  const at = Date.parse(approval.stepUpAt ?? "");
  if (!Number.isFinite(at) || at > Date.now() || Date.now() - at > 300_000)
    return reject("APPROVAL_STEP_UP_EXPIRED", 403);
  const permission = permissions[candidate.kind];
  const initiator = await currentAuthority(
    manager,
    { kind: "PROJECT", ...scope },
    candidate.initiator.principalId,
    permission,
    "system-administrator",
  );
  const approver = await currentAuthority(
    manager,
    { kind: "PROJECT", ...scope },
    approval.approver.principalId,
    permission,
    "system-administrator",
  );
  if (
    !same(initiator.human.authorizationBasisRef, candidate.initiator.authorizationBasisRef) ||
    !same(approver.human.authorizationBasisRef, approval.approver.authorizationBasisRef)
  )
    return reject("ACTION_AUTHORIZATION_CHANGED", 403);
  let consumed: ProjectActionApproval;
  try {
    consumed = consumeAuthorizedProjectAction(candidate, approval, {
      now: new Date().toISOString(),
      currentOnboardingVersion: currentVersion,
      initiatorCurrentlyAuthorized: true,
      approverCurrentlyAuthorized: true,
      prerequisitesCurrent: true,
    });
  } catch {
    return reject("EXACT_APPROVAL_INVALID", 409);
  }
  await manager.query(
    "UPDATE approvals SET effect_authorization_state='CONSUMED',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
    [...scopeArgs(scope), approval.approvalId],
  );
  return consumed;
}

export class DurableProjectOperationsApplication {
  constructor(private readonly source: DataSource) {}
  private async transaction<T>(
    request: OnboardingRequest,
    permission: string,
    role: string | undefined,
    stepUp: boolean,
    key: string,
    input: unknown,
    work: (
      manager: EntityManager,
      current: ProjectOnboardingRevision,
      authority: AdministrativeAuthority,
    ) => Promise<T>,
  ) {
    await request.authorize(permission);
    return this.source.transaction(async (manager) => {
      // One order across administrative commands, including idempotent replay.
      const current = await lockOnboarding(manager, request);
      const authority = await authorizeAdministrative(manager, request, permission, role, stepUp);
      return command(
        manager,
        request,
        authority.actor.principalId,
        permission,
        key,
        input,
        async () => {
          const result = await work(manager, current, authority);
          await request.authorize(permission);
          return result;
        },
      );
    });
  }
  async read(request: OnboardingRequest) {
    await request.authorize("project.onboarding.read");
    return this.source.transaction(async (manager) => {
      const current = await lockOnboarding(manager, request);
      await authorizeAdministrative(manager, request, "project.onboarding.read");
      return current;
    });
  }
  async suspend(
    request: OnboardingRequest,
    input: Readonly<{ expectedVersion: number; incidentRef: string; reason: string }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.suspend",
      "system-administrator",
      false,
      key,
      input,
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion || current.operationalState !== "ACTIVE")
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const { contentHash: _hash, ...body } = current;
        void _hash;
        const next = createOnboardingRevision({
          ...body,
          revisionId: randomUUID(),
          version: current.version + 1,
          operationalState: "SUSPENDED",
          incidentRef: input.incidentRef,
          reason: input.reason,
          reasonCode: "PROJECT_SUSPENDED",
          actor: authority.human,
          createdAt: new Date().toISOString(),
          correlationId: randomUUID(),
        });
        await appendOnboarding(manager, next);
        await this.invalidatePending(manager, request, authority);
        await auditAndEvent(
          manager,
          request,
          authority,
          "PROJECT_SUSPENDED",
          revisionRef(next),
          input.reason,
          "PROJECT_OPERATIONAL_STATE_CHANGED",
        );
        return {
          status: "COMPLETED" as const,
          resultRef: revisionRef(next),
          state: next.operationalState,
          version: next.version,
          mode: next.qaCapabilityMode,
        };
      },
    );
  }
  private async invalidatePending(
    manager: EntityManager,
    scope: ProjectScope,
    authority: AdministrativeAuthority,
  ) {
    await manager.query(
      "UPDATE platform_actions SET state='INVALIDATED',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND state IN('PENDING','APPROVED','PROPOSED')",
      scopeArgs(scope),
    );
    const commands = (await manager.query(
      "SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND state IN('AWAITING_APPROVAL','QUEUED') ORDER BY id FOR UPDATE",
      scopeArgs(scope),
    )) as { id: string }[];
    const cancelled: string[] = [];
    const repository = new TypeOrmCommandRepository(this.source);
    for (const { id } of commands) {
      const command = await repository.get(scope.workspaceId, scope.projectId, id, manager);
      if (!command || command.effectInvocationStartedAt) continue;
      cancelled.push(id);
      await repository.save(
        {
          ...command,
          status: "CANCELLED",
          effectAuthorizationStatus: "INVALIDATED",
          outboxStatus: "DEAD",
          effectGateDecision: "DENIED",
          effectGateReasonCode: "PROJECT_SUSPENDED",
          effectGateEvaluatedAt: new Date(),
          effectAuthorizationBasis: authority.basis,
          effectAuthorizationBasisHash: digest(authority.basis),
          rowVersion: command.rowVersion + 1,
          updatedAt: new Date(),
        },
        command.rowVersion,
        manager,
      );
      await manager.query(
        "UPDATE command_outbox SET state='DEAD',lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state IN('HELD','READY','LEASED','ENQUEUED')",
        [...scopeArgs(scope), id],
      );
    }
    const approvals = (await manager.query(
      "SELECT id,subject FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND effect_authorization_state IN('AUTHORIZED','NOT_AUTHORIZED','PENDING','CONSUMED') AND (action_id IN(SELECT id FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND state='INVALIDATED') OR action_id=ANY($3::uuid[])) FOR UPDATE",
      [...scopeArgs(scope), cancelled],
    )) as { id: string; subject: Approval | ProjectActionApproval }[];
    for (const row of approvals) {
      const subject =
        "decisionStatus" in row.subject
          ? {
              ...row.subject,
              decisionStatus:
                row.subject.decisionStatus === "PENDING" ? "CANCELLED" : row.subject.decisionStatus,
              effectAuthorizationStatus: "INVALIDATED",
              invalidatedAt: new Date(),
              invalidationReason: "EXPECTED_STATE_CHANGED",
              resourceVersion: row.subject.resourceVersion + 1,
            }
          : row.subject;
      await manager.query(
        "UPDATE approvals SET subject=$4,effect_authorization_state='INVALIDATED',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [...scopeArgs(scope), row.id, subject],
      );
    }
  }
  async disposition(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      incidentRef: string;
      outcome: "ACCEPTED" | "REJECTED";
      reason: string;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.resume",
      "system-administrator",
      false,
      key,
      { operation: "disposition", ...input },
      async (manager, current, authority) => {
        if (
          current.version !== input.expectedVersion ||
          current.operationalState !== "SUSPENDED" ||
          current.incidentRef !== input.incidentRef
        )
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const body = {
          dispositionId: randomUUID(),
          ...requestScope(request),
          incidentRef: input.incidentRef,
          onboardingRevisionId: current.revisionId,
          outcome: input.outcome,
          actorId: authority.actor.principalId,
          reason: input.reason,
          createdAt: new Date().toISOString(),
        };
        const value = { ...body, contentHash: digest(body) };
        await manager.query(
          "INSERT INTO project_incident_dispositions(disposition_id,workspace_id,project_id,incident_ref,onboarding_revision_id,outcome,actor_id,created_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            value.dispositionId,
            value.workspaceId,
            value.projectId,
            value.incidentRef,
            value.onboardingRevisionId,
            value.outcome,
            value.actorId,
            value.createdAt,
            value,
            value.contentHash,
          ],
        );
        const resultRef = ref(value.dispositionId, 1, value.contentHash);
        await auditAndEvent(
          manager,
          request,
          authority,
          "PROJECT_INCIDENT_DISPOSITION_RECORDED",
          resultRef,
          input.reason,
        );
        return { status: "COMPLETED" as const, resultRef };
      },
    );
  }
  private async prerequisites(
    manager: EntityManager,
    current: ProjectOnboardingRevision,
    dispositionRef: ExactRevisionRef,
  ) {
    const dispositions = (await manager.query(
      "SELECT semantic_body,content_hash FROM project_incident_dispositions WHERE workspace_id=$1 AND project_id=$2 AND incident_ref=$3 ORDER BY created_at DESC,disposition_id DESC LIMIT 1",
      [...scopeArgs(current), current.incidentRef],
    )) as { semantic_body: Disposition; content_hash: string }[];
    const row = dispositions[0],
      d = row?.semantic_body;
    if (
      !row ||
      !d ||
      d.outcome !== "ACCEPTED" ||
      d.onboardingRevisionId !== current.revisionId ||
      !validHash(d) ||
      row.content_hash !== d.contentHash ||
      !same(ref(d.dispositionId, 1, d.contentHash), dispositionRef)
    )
      return reject("INCIDENT_DISPOSITION_STALE", 409);
    if (!current.bindingRef || !current.qaProjectContextRef)
      return reject("RESUME_CONFIGURATION_REQUIRED");
    const head = await bindingHead(manager, current, current.bindingRef.id),
      binding = await bindingRevision(manager, current, current.bindingRef);
    if (
      head.current_published_version !== current.bindingRef.version ||
      binding.status !== "PUBLISHED"
    )
      return reject("RESUME_BINDING_STALE", 409);
    const configuration = await configurationFacts(manager, current, binding);
    await contextFact(manager, current);
    const rows = (await manager.query(
      "SELECT DISTINCT ON(logical_role,operation) semantic_body,content_hash FROM capability_probe_results WHERE workspace_id=$1 AND project_id=$2 AND binding_ref->>'id'=$3 ORDER BY logical_role,operation,observed_at DESC,probe_id DESC",
      [...scopeArgs(current), current.bindingRef.id],
    )) as { semantic_body: CapabilityProbeResult; content_hash: string }[];
    const probes = rows.map((r) => {
      if (
        !validHash(r.semantic_body as unknown as { contentHash: string }) ||
        r.content_hash !== r.semantic_body.contentHash ||
        !Number.isFinite(Date.parse(r.semantic_body.observedAt)) ||
        Date.parse(r.semantic_body.observedAt) > Date.now()
      )
        return reject("RESUME_PROBE_INVALID");
      return r.semantic_body;
    });
    const manualRoles = ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"];
    const requirements = [
      { role: "QA_REQUEST_AUTHORITY", operations: ["request.create", "request.transition"] },
      { role: "SOURCE_CONTEXT", operations: ["request.read"] },
      { role: "DEFECT_DESTINATION", operations: ["defect.create"] },
    ];
    const entries = binding.content.entries as {
      logicalRole: string;
      capabilityKey: string;
      exactContractVersion: string;
      profileRef: ExactRevisionRef;
      environmentScope: string;
    }[];
    if (!Array.isArray(entries)) return reject("RESUME_BINDING_INVALID", 409);
    for (const requirement of requirements) {
      const selected = entries.filter(
        (entry) =>
          entry.logicalRole === requirement.role && entry.capabilityKey === "operational-work-item",
      );
      if (selected.length !== 1) return reject("RESUME_BINDING_INVALID", 409);
      const entry = selected[0]!;
      const profileRef = configuration.find(
        (value) => value.id === entry.profileRef.id && value.version === entry.profileRef.version,
      );
      const profiles = (await manager.query(
        "SELECT content FROM connector_profile_revisions WHERE workspace_id=$1 AND header_id=$2 AND version=$3",
        [current.workspaceId, entry.profileRef.id, entry.profileRef.version],
      )) as { content: { connectionRef: ExactRevisionRef } }[];
      const pin = profiles[0]?.content.connectionRef;
      const connectionRef =
        pin && configuration.find((value) => value.id === pin.id && value.version === pin.version);
      if (!profileRef || !connectionRef) return reject("RESUME_CONFIGURATION_STALE", 409);
      for (const operation of requirement.operations) {
        const probe = probes.find(
          (p) => p.logicalRole === requirement.role && p.operation === operation,
        );
        if (
          !probe ||
          probe.status !== "AVAILABLE" ||
          !Number.isFinite(Date.parse(probe.validUntil)) ||
          Date.parse(probe.validUntil) <= Date.now() ||
          !same(probe.bindingRef, current.bindingRef) ||
          !same(probe.profileRef, profileRef) ||
          !same(probe.connectionRef, connectionRef) ||
          probe.capabilityKey !== entry.capabilityKey ||
          probe.exactContractVersion !== entry.exactContractVersion ||
          probe.environmentScope !== entry.environmentScope
        )
          return reject("RESUME_MANUAL_PROBES_STALE", 409);
      }
    }

    const fresh = probes.filter(
      (p) =>
        p.status === "AVAILABLE" &&
        Date.parse(p.validUntil) > Date.now() &&
        same(p.bindingRef, current.bindingRef),
    );
    const assessment = assessProjectCapabilityMode({
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      bindingRef: current.bindingRef,
      contextRef: current.qaProjectContextRef,
      requirementSetRef: ref("qa-resume-manual-roles", 1, digest(manualRoles)),
      probes: fresh.map((p) => ({
        ref: ref(p.probeId, 1, p.contentHash),
        requirement:
          p.capabilityKey === "operational-work-item" && manualRoles.includes(p.logicalRole)
            ? ("MANUAL" as const)
            : p.logicalRole === "PILOT_MESSAGING"
              ? ("PILOT_MESSAGING" as const)
              : ("AUTOMATION" as const),
        status: p.status,
        validUntil: p.validUntil,
      })),
      now: new Date().toISOString(),
    });
    // Promotion additionally needs a verified accepted automation suite; absence safely lowers mode.
    return {
      freshProbeRefs: fresh
        .map((p) => ref(p.probeId, 1, p.contentHash))
        .sort((a, b) => a.id.localeCompare(b.id)),
      mode: assessment.derivedMode,
    };
  }
  async prepareResume(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      incidentDispositionRef: ExactRevisionRef;
      reason: string;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.resume",
      "system-administrator",
      true,
      key,
      { operation: "prepare", ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion || current.operationalState !== "SUSPENDED")
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const facts = await this.prerequisites(manager, current, input.incidentDispositionRef),
          now = new Date();
        const candidate = createProjectResumeActionCandidate({
          current,
          actionId: randomUUID(),
          incidentDispositionRef: input.incidentDispositionRef,
          freshProbeRefs: facts.freshProbeRefs,
          initiator: authority.human,
          reason: input.reason,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 300_000).toISOString(),
        });
        await saveOperationalCandidate(manager, candidate);
        await auditAndEvent(
          manager,
          request,
          authority,
          "PROJECT_RESUME_REQUESTED",
          actionRef(candidate),
          input.reason,
        );
        return { status: "PENDING_APPROVAL" as const, resultRef: actionRef(candidate), candidate };
      },
    );
  }
  async approve(
    request: OnboardingRequest,
    input: Readonly<{ expectedVersion: number; candidateRef: ExactRevisionRef }>,
    key: string,
  ) {
    await request.authorize("project.onboarding.read");
    // Permission is selected from the persisted candidate, never a client action kind.
    const rows = (await this.source.query(
      "SELECT action_kind FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [...scopeArgs(request), input.candidateRef.id],
    )) as { action_kind: ProjectActionCandidate["kind"] }[];
    const permission = rows[0] && permissions[rows[0].action_kind];
    if (!permission) return reject("EXACT_ACTION_UNAVAILABLE", 404);
    return this.transaction(
      request,
      permission,
      "system-administrator",
      true,
      key,
      { operation: "approve", ...input },
      async (manager, current, authority) => {
        if (current.version !== input.expectedVersion)
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const candidate = await loadOperationalCandidate(manager, request, input.candidateRef);
        if (
          candidate.expectedOnboardingVersion !== current.version ||
          candidate.initiator.principalId === authority.actor.principalId
        )
          return reject("DISTINCT_CURRENT_APPROVER_REQUIRED", 403);
        if (candidate.kind === "PROJECT_RESUME")
          await this.prerequisites(
            manager,
            current,
            (candidate as ProjectResumeActionCandidate).incidentDispositionRef,
          );
        const approval: ProjectActionApproval = {
          approvalId: randomUUID(),
          subjectKind: "PLATFORM_ACTION",
          actionKind: candidate.kind,
          actionId: candidate.actionId,
          targetHash: candidate.contentHash,
          initiatorPrincipalId: candidate.initiator.principalId,
          approver: authority.human,
          stepUpAt: authority.human.stepUpAt!,
          approvedAt: new Date().toISOString(),
          expiresAt: candidate.expiresAt,
        };
        await manager.query(
          "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,approver_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'APPROVED','AUTHORIZED',$8,$9,$10,$11)",
          [
            approval.approvalId,
            request.workspaceId,
            request.projectId,
            candidate.kind,
            candidate.actionId,
            approval,
            candidate.contentHash,
            candidate.initiator.principalId,
            authority.actor.principalId,
            approval.expiresAt,
            approval.approvedAt,
          ],
        );
        const resultRef = ref(approval.approvalId, 1, digest(approval));
        await auditAndEvent(
          manager,
          request,
          authority,
          "PROJECT_ACTION_APPROVED",
          resultRef,
          candidate.reason,
        );
        return { status: "APPROVED" as const, resultRef };
      },
    );
  }
  async resume(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      incidentRef: string;
      incidentDispositionRef: ExactRevisionRef;
      freshProbeRefs: readonly ExactRevisionRef[];
      actionCandidateRef: ExactRevisionRef;
      approvalRef: ExactRevisionRef;
      reason: string;
    }>,
    key: string,
  ) {
    return this.transaction(
      request,
      "project.resume",
      "system-administrator",
      true,
      key,
      { operation: "resume", ...input },
      async (manager, current, authority) => {
        if (
          current.version !== input.expectedVersion ||
          current.operationalState !== "SUSPENDED" ||
          current.incidentRef !== input.incidentRef
        )
          return reject("ONBOARDING_VERSION_CONFLICT", 409);
        const candidate = (await loadOperationalCandidate(
          manager,
          request,
          input.actionCandidateRef,
        )) as ProjectResumeActionCandidate;
        const facts = await this.prerequisites(manager, current, input.incidentDispositionRef);
        const sorted = (refs: readonly ExactRevisionRef[]) =>
          [...refs].sort((a, b) => a.id.localeCompare(b.id));
        if (
          candidate.kind !== "PROJECT_RESUME" ||
          candidate.initiator.principalId !== authority.actor.principalId ||
          !same(candidate.targetRef, revisionRef(current)) ||
          candidate.reason !== input.reason ||
          !same(candidate.incidentDispositionRef, input.incidentDispositionRef) ||
          !same(sorted(candidate.freshProbeRefs), facts.freshProbeRefs) ||
          !same(sorted(input.freshProbeRefs), facts.freshProbeRefs)
        )
          return reject("RESUME_PREREQUISITES_CHANGED", 409);
        await consumeOperationalApproval(
          manager,
          request,
          candidate,
          input.approvalRef,
          current.version,
        );
        const { contentHash: _hash, ...body } = current;
        void _hash;
        const next = createOnboardingRevision({
          ...body,
          revisionId: randomUUID(),
          version: current.version + 1,
          operationalState: "ACTIVE",
          qaCapabilityMode: facts.mode,
          reason: input.reason,
          reasonCode: "PROJECT_RESUMED",
          actor: authority.human,
          causationId: candidate.actionId,
          createdAt: new Date().toISOString(),
          correlationId: randomUUID(),
        });
        await appendOnboarding(manager, next);
        const result = {
          status: "COMPLETED" as const,
          resultRef: revisionRef(next),
          state: next.operationalState,
          version: next.version,
          mode: next.qaCapabilityMode,
        };
        await manager.query(
          "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [...scopeArgs(request), candidate.actionId, result],
        );
        await auditAndEvent(
          manager,
          request,
          authority,
          "PROJECT_RESUMED",
          revisionRef(next),
          input.reason,
          "PROJECT_OPERATIONAL_STATE_CHANGED",
        );
        return result;
      },
    );
  }
}
function requestScope(r: ProjectScope): ProjectScope {
  return { workspaceId: r.workspaceId, projectId: r.projectId };
}
