import type { DataSource } from "typeorm";

import {
  assertExactRevisionRef,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type PilotEffectContext,
  type PilotFencePort,
  type PilotFenceSnapshot,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";
import { TypeOrmCorporateScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import {
  assertPilotFenceActionDetails,
  type PilotFenceAction,
  pilotFenceCohortRecord,
} from "./fence-action.ts";
import { matchesPilotOnboardingPin } from "./onboarding-pin.ts";

/** V1 body of an immutable FENCE pilot record. Its own ref is the record's hash. */
export interface PublishedPilotFenceV1 {
  readonly schemaVersion: 1;
  readonly mode: PilotFenceSnapshot["mode"];
  readonly environment: "NON_PROD";
  readonly deploymentRef: ExactRevisionRef;
  readonly cohortRef: ExactRevisionRef;
  readonly runtimeInstanceId: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
}
type Row = {
  semantic_body: Record<string, unknown>;
  content_hash: `sha256:${string}`;
  record_id: string;
  current_version: number;
};
type Cohort = {
  cohortId: string;
  version: number;
  state: string;
  contentHash: string;
  startAt: string;
  endAt: string;
  projects: readonly { workspaceId: string; projectId: string; onboardingRef: ExactRevisionRef }[];
  userIds: readonly string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const fail = (): never => {
  throw new Error("PILOT_FENCE_UNAVAILABLE");
};

/** Reads current heads on every invocation; no browser or cached membership supplies authority. */
export class PublishedPilotFence implements PilotFencePort {
  readonly #access: TypeOrmCorporateScopedAccessRepository;
  readonly #authorization = new DenyByDefaultAuthorizationPolicy();
  constructor(
    private readonly source: DataSource,
    private readonly workspaceId: string,
    private readonly projectIds: readonly string[],
    private readonly permission = "qa.request.confirm",
  ) {
    if (
      !source.isInitialized ||
      !uuid.test(workspaceId) ||
      !projectIds.length ||
      projectIds.some((id) => !uuid.test(id)) ||
      !/^[a-z][a-z0-9_.-]{0,127}$/u.test(permission)
    )
      fail();
    this.#access = new TypeOrmCorporateScopedAccessRepository(source);
  }

  async current(scope: ProjectScope): Promise<PilotFenceSnapshot | undefined> {
    if (scope.workspaceId !== this.workspaceId || !this.projectIds.includes(scope.projectId))
      return undefined;
    const records = (await this.source.query(
      `SELECT r.semantic_body,r.content_hash,h.record_id,h.current_version
       FROM pilot_record_headers h JOIN pilot_record_revisions r
       ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.kind='FENCE' LIMIT 2`,
      [scope.workspaceId, scope.projectId],
    )) as Row[];
    if (records.length !== 1) return undefined;
    const record = this.record(records[0]!, scope, "FENCE");
    const body = record.body as unknown as PublishedPilotFenceV1;
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          ![
            "schemaVersion",
            "mode",
            "environment",
            "deploymentRef",
            "cohortRef",
            "runtimeInstanceId",
            "startsAt",
            "expiresAt",
            "revoked",
          ].includes(key),
      ) ||
      body.schemaVersion !== 1 ||
      !["DENY", "SANDBOX_CONFORMANCE", "SHADOW", "COHORT_WRITES", "RECOVERY"].includes(body.mode) ||
      body.environment !== "NON_PROD" ||
      !uuid.test(body.runtimeInstanceId) ||
      typeof body.revoked !== "boolean" ||
      !Number.isFinite(Date.parse(body.startsAt)) ||
      !Number.isFinite(Date.parse(body.expiresAt)) ||
      Date.parse(body.startsAt) >= Date.parse(body.expiresAt)
    )
      fail();
    assertExactRevisionRef(body.deploymentRef);
    assertExactRevisionRef(body.cohortRef);
    const cohorts = (await this.source.query(
      `SELECT r.semantic_body,r.content_hash,h.record_id,h.current_version
       FROM pilot_record_headers h JOIN pilot_record_revisions r
       ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.kind='COHORT' AND h.record_id=$3`,
      [scope.workspaceId, scope.projectId, body.cohortRef.id],
    )) as Row[];
    if (cohorts.length !== 1) return undefined;
    const cohortRecord = this.record(cohorts[0]!, scope, "COHORT");
    if (
      !samePilotRef(body.cohortRef, {
        id: cohorts[0]!.record_id,
        version: cohorts[0]!.current_version,
        contentHash: cohorts[0]!.content_hash,
      })
    )
      return undefined;
    const cohort = cohortRecord.body as unknown as Cohort;
    if (
      !cohort ||
      !Array.isArray(cohort.projects) ||
      !Array.isArray(cohort.userIds) ||
      cohort.cohortId !== cohorts[0]!.record_id ||
      cohort.version !== cohorts[0]!.current_version ||
      !["CURRENT", "REVOKED"].includes(cohort.state) ||
      cohort.userIds.length > 1000 ||
      cohort.userIds.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      new Set(cohort.userIds).size !== cohort.userIds.length ||
      cohort.projects.length > 100 ||
      (cohort.projects as Cohort["projects"]).some(
        (project) =>
          !project ||
          project.workspaceId !== this.workspaceId ||
          !this.projectIds.includes(project.projectId),
      ) ||
      new Set((cohort.projects as Cohort["projects"]).map((project) => project.projectId)).size !==
        cohort.projects.length ||
      !(cohort.projects as Cohort["projects"]).some(
        (project) => project.projectId === scope.projectId,
      ) ||
      !Number.isFinite(Date.parse(cohort.startAt)) ||
      !Number.isFinite(Date.parse(cohort.endAt))
    )
      fail();
    if (Date.parse(cohort.startAt) >= Date.parse(cohort.endAt)) fail();
    const { contentHash, ...cohortBody } = cohort;
    if (pilotContentHash(cohortBody) !== contentHash) fail();
    if (typeof record.correlationId !== "string" || !uuid.test(record.correlationId))
      return undefined;
    const proofs = (await this.source.query(
      `SELECT a.candidate_ref,c.content_hash,ap.subject,ap.subject_hash,ap.decision_state,ap.effect_authorization_state
       FROM platform_actions a JOIN project_operational_action_candidates c
       ON (c.workspace_id,c.project_id,c.action_id)=(a.workspace_id,a.project_id,a.id)
       JOIN approvals ap ON (ap.workspace_id,ap.project_id,ap.action_id)=(a.workspace_id,a.project_id,a.id)
       WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3 AND a.action_kind='PILOT_FENCE_PUBLISH'
         AND a.state='COMPLETED' AND c.action_kind='PILOT_FENCE_PUBLISH'
         AND ap.decision_state='APPROVED' AND ap.effect_authorization_state='CONSUMED' LIMIT 2`,
      [scope.workspaceId, scope.projectId, record.correlationId],
    )) as {
      candidate_ref: PilotFenceAction;
      content_hash: string;
      subject: {
        actionKind: string;
        actionId: string;
        targetHash: string;
        initiatorPrincipalId: string;
        approver?: { principalId?: string };
        stepUpAt?: string;
      };
      subject_hash: string;
      decision_state: string;
      effect_authorization_state: string;
    }[];
    if (proofs.length !== 1) return undefined;
    const proof = proofs[0]!;
    try {
      assertPilotFenceActionDetails(proof.candidate_ref);
    } catch {
      return undefined;
    }
    const candidate = proof.candidate_ref,
      approval = proof.subject;
    if (
      proof.content_hash !== candidate.contentHash ||
      proof.subject_hash !== candidate.contentHash ||
      approval.actionKind !== "PILOT_FENCE_PUBLISH" ||
      approval.actionId !== candidate.actionId ||
      approval.targetHash !== candidate.contentHash ||
      approval.initiatorPrincipalId !== candidate.initiator.principalId ||
      !approval.approver?.principalId ||
      approval.approver.principalId === approval.initiatorPrincipalId ||
      !approval.stepUpAt ||
      !Number.isFinite(Date.parse(approval.stepUpAt)) ||
      record.actorRef !== candidate.initiator.principalId ||
      pilotContentHash(candidate.pilotFence.fence) !== pilotContentHash(body) ||
      pilotFenceCohortRecord(candidate, candidate.pilotFence).contentHash !==
        cohorts[0]!.content_hash
    )
      return undefined;
    const project = (cohort.projects as Cohort["projects"]).find(
      (value) => value.projectId === scope.projectId,
    )!;
    assertExactRevisionRef(project.onboardingRef);
    const heads = (await this.source.query(
      `SELECT h.onboarding_id,h.current_version,r.revision_id,r.content_hash,r.semantic_body
       FROM project_onboarding_headers h JOIN project_onboarding_revisions r
       ON (r.workspace_id,r.project_id,r.onboarding_id,r.version)=(h.workspace_id,h.project_id,h.onboarding_id,h.current_version)
       WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.current_stage='PILOT_ACTIVE'
         AND h.current_operational_state='ACTIVE'`,
      [scope.workspaceId, scope.projectId],
    )) as readonly {
      onboarding_id: string;
      current_version: number;
      revision_id: string;
      content_hash: string;
      semantic_body: Record<string, unknown>;
    }[];
    const head = heads[0];
    if (!head || heads.length !== 1) return undefined;
    const onboarding = head.semantic_body;
    if (
      !onboarding ||
      onboarding.contentHash !== head.content_hash ||
      onboarding.workspaceId !== scope.workspaceId ||
      onboarding.projectId !== scope.projectId ||
      onboarding.version !== head.current_version ||
      onboarding.revisionId !== head.revision_id ||
      onboarding.onboardingId !== head.onboarding_id ||
      onboarding.stage !== "PILOT_ACTIVE" ||
      onboarding.operationalState !== "ACTIVE"
    )
      return undefined;
    const { contentHash: onboardingHash, ...onboardingBody } = onboarding;
    if (pilotContentHash(onboardingBody) !== onboardingHash) return undefined;
    if (
      !(await matchesPilotOnboardingPin(
        this.source,
        scope,
        project.onboardingRef,
        onboarding as unknown as Parameters<typeof matchesPilotOnboardingPin>[3],
      ))
    )
      return undefined;
    const startsAt = new Date(
      Math.max(Date.parse(body.startsAt), Date.parse(cohort.startAt)),
    ).toISOString();
    const expiresAt = new Date(
      Math.min(Date.parse(body.expiresAt), Date.parse(cohort.endAt)),
    ).toISOString();
    if (Date.parse(startsAt) >= Date.parse(expiresAt)) fail();
    return freezePilotValue({
      ...scope,
      mode: body.mode,
      environment: body.environment,
      fenceRef: {
        id: records[0]!.record_id,
        version: records[0]!.current_version,
        contentHash: records[0]!.content_hash,
      },
      deploymentRef: body.deploymentRef,
      cohortRef: body.cohortRef,
      runtimeInstanceId: body.runtimeInstanceId,
      projectIds: (cohort.projects as Cohort["projects"]).map((project) => project.projectId),
      principalIds: [...cohort.userIds],
      startsAt,
      expiresAt,
      revoked: body.revoked || cohort.state !== "CURRENT",
    });
  }

  async authorize(scope: ProjectScope, context: PilotEffectContext): Promise<boolean> {
    try {
      if (scope.workspaceId !== this.workspaceId || !this.projectIds.includes(scope.projectId))
        return false;
      const rows = (await this.source.query(
        "SELECT issuer,subject,kind FROM identities WHERE id=$1",
        [context.principalId],
      )) as { issuer: string; subject: string; kind: string }[];
      const identity = rows[0];
      if (!identity || identity.kind !== "HUMAN") return false;
      const projectScope = { kind: "PROJECT" as const, ...scope };
      const [workspace, project, onboarding] = await Promise.all([
        this.#access.getWorkspace({ kind: "WORKSPACE", workspaceId: scope.workspaceId }),
        this.#access.getProject(projectScope),
        this.source.query(
          "SELECT current_stage,current_operational_state FROM project_onboarding_headers WHERE workspace_id=$1 AND project_id=$2",
          [scope.workspaceId, scope.projectId],
        ) as Promise<{ current_stage: string; current_operational_state: string }[]>,
      ]);
      if (
        workspace?.state !== "ACTIVE" ||
        project?.state !== "ACTIVE" ||
        onboarding.length !== 1 ||
        onboarding[0]!.current_stage !== "PILOT_ACTIVE" ||
        onboarding[0]!.current_operational_state !== "ACTIVE"
      )
        return false;
      const at = new Date();
      return this.#authorization.decide({
        context: {
          scope: projectScope,
          actor: {
            kind: "HUMAN",
            principalId: context.principalId,
            issuer: identity.issuer,
            subject: identity.subject,
          },
          correlationId: "pilot-fence",
          causationId: "pilot-fence",
        },
        permission: this.permission,
        resourceClassification: project.classification,
        facts: await this.#access.authorizationFacts(projectScope, context.principalId, at),
        at,
        operationClass: "MUTATE",
        projectOperationalState: "ACTIVE",
      }).allowed;
    } catch {
      return false;
    }
  }

  private record(row: Row, scope: ProjectScope, kind: "FENCE" | "COHORT") {
    const value = row.semantic_body;
    if (
      !value ||
      value.workspaceId !== scope.workspaceId ||
      value.projectId !== scope.projectId ||
      value.id !== row.record_id ||
      value.version !== row.current_version ||
      value.kind !== kind ||
      value.schemaVersion !== 1 ||
      !value.body ||
      typeof value.body !== "object" ||
      Array.isArray(value.body) ||
      pilotContentHash(value) !== row.content_hash
    )
      return fail();
    return value;
  }
}
