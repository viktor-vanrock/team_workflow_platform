import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  containsSensitiveValue008,
  type ExactRevisionRef,
  pilotContentHash,
  type PilotRecord,
  samePilotRef,
  validateInputPackage008,
} from "@awp/platform-core";
import { PilotRepository, RuntimeConfigurationRepository } from "@awp/platform-persistence-typeorm";
import {
  assertPilotFenceActionDetails,
  createInitialPilotCohort,
  createPilotFenceAction,
  loadEnvironment,
  matchesPilotOnboardingPin,
  pilotCohortScopeHash,
  type PilotFenceAction,
  type PilotFenceActionDetails,
  pilotFenceCohortRecord,
  type PilotReadinessQuery,
} from "@awp/runtime-composition";

import {
  auditAndEvent,
  authorizeAdministrative,
  command,
  lockOnboarding,
  type OnboardingRequest,
  ref,
  reject,
} from "../onboarding/durable-http.ts";
import {
  consumeOperationalApproval,
  loadOperationalCandidate,
  saveOperationalCandidate,
} from "../onboarding/project-operations.application.ts";

export function matchesReviewedCohort(
  metadata: unknown,
  cohort: PilotFenceActionDetails["cohort"],
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const value = metadata as Record<string, unknown>;
  if (
    value.cohortRef !== pilotCohortScopeHash(cohort) ||
    value.sponsorRef !== cohort.sponsorRef ||
    value.qaLeadRef !== cohort.qaLeadRef ||
    !Array.isArray(value.humanRefs)
  )
    return false;
  const humanRefs: unknown[] = value.humanRefs;
  return (
    humanRefs.length === cohort.userIds.length &&
    new Set(humanRefs).size === cohort.userIds.length &&
    cohort.userIds.every((id) => humanRefs.includes(id))
  );
}

export function matchesCurrentPilotGates(
  gates: readonly {
    gate_kind: string;
    gate_result_id: string;
    content_hash: string;
    outcome: string;
    valid_until: Date | null;
  }[],
  expected: PilotFenceActionDetails["cohort"]["gateRefs"],
  now: number,
): boolean {
  return (
    gates.length === 4 &&
    expected.length === 4 &&
    new Set(gates.map((gate) => gate.gate_kind)).size === 4 &&
    gates.every(
      (gate) =>
        ["L0", "C1", "N2", "P3"].includes(gate.gate_kind) &&
        gate.outcome === "PASS" &&
        !!gate.valid_until &&
        new Date(gate.valid_until).getTime() > now &&
        expected.some(
          (value) =>
            value.kind === gate.gate_kind &&
            value.id === gate.gate_result_id &&
            value.contentHash === gate.content_hash,
        ),
    )
  );
}

/** Exact approval of one proposed cohort and fence; never creates a provider effect. */
export class PilotFencePublicationApplication {
  constructor(
    private readonly source: DataSource,
    private readonly readiness: PilotReadinessQuery,
  ) {}

  private async ready(request: OnboardingRequest, deploymentRef: ExactRevisionRef): Promise<void> {
    const environment = loadEnvironment();
    if (
      environment.profile !== "non-local" ||
      environment.environmentScope !== "NON_PROD" ||
      !environment.deployment ||
      environment.deployment.workspaceId !== request.workspaceId ||
      !environment.deployment.projectIds.includes(request.projectId) ||
      environment.deployment.deploymentId !== deploymentRef.id
    )
      return reject("PILOT_DEPLOYMENT_UNAVAILABLE", 403);
    const result = await this.readiness.readiness(
      { ...request, authorize: async (permission) => await request.authorize(permission) },
      deploymentRef.id,
    );
    if (!result.corporateGatesReady || !samePilotRef(result.deploymentRef, deploymentRef))
      return reject("PILOT_READINESS_REQUIRED", 409);
  }

  private async verifyInputs(
    manager: EntityManager,
    request: OnboardingRequest,
    candidate: PilotFenceAction,
    onboarding: Awaited<ReturnType<typeof lockOnboarding>>,
  ): Promise<void> {
    try {
      assertPilotFenceActionDetails(candidate);
    } catch {
      return reject("PILOT_FENCE_ACTION_INVALID", 409);
    }
    if (
      !(await matchesPilotOnboardingPin(
        manager,
        request,
        candidate.pilotFence.cohort.projects[0]!.onboardingRef,
        onboarding,
      ))
    )
      return reject("PILOT_ONBOARDING_CHANGED", 409);
    const cohort = candidate.pilotFence.cohort;
    if (
      Object.keys(cohort).some(
        (key) =>
          ![
            "cohortId",
            "version",
            "projects",
            "userIds",
            "channelRefs",
            "environmentRefs",
            "suiteRefs",
            "gateRefs",
            "startAt",
            "endAt",
            "sponsorRef",
            "qaLeadRef",
            "onCallRef",
            "rollbackRunbookRef",
            "comparisonProtocolRef",
            "state",
            "predecessorHash",
            "contentHash",
          ].includes(key),
      )
    )
      return reject("PILOT_COHORT_INVALID", 409);
    const {
      version: _version,
      state: _state,
      predecessorHash: _predecessor,
      contentHash: _hash,
      ...body
    } = cohort;
    void _version;
    void _state;
    void _predecessor;
    void _hash;
    const rebuilt = createInitialPilotCohort(body);
    if (pilotContentHash(rebuilt) !== pilotContentHash(cohort))
      return reject("PILOT_COHORT_INVALID", 409);
    const gates = (await manager.query(
      `SELECT DISTINCT ON(gate_kind) gate_kind,gate_result_id,content_hash,outcome,valid_until
       FROM project_onboarding_gate_results
       WHERE workspace_id=$1 AND project_id=$2 AND gate_kind IN ('L0','C1','N2','P3') AND subject_refs=$3::jsonb
       ORDER BY gate_kind,evaluated_at DESC,gate_result_id DESC`,
      [
        request.workspaceId,
        request.projectId,
        JSON.stringify([candidate.pilotFence.fence.deploymentRef]),
      ],
    )) as readonly {
      gate_kind: string;
      gate_result_id: string;
      content_hash: string;
      outcome: string;
      valid_until: Date | null;
    }[];
    if (!matchesCurrentPilotGates(gates, cohort.gateRefs, Date.now()))
      return reject("PILOT_COHORT_GATE_STALE", 409);
    const environment = loadEnvironment();
    if (!environment.deployment) return reject("PILOT_DEPLOYMENT_UNAVAILABLE", 403);
    const input = await new RuntimeConfigurationRepository().current(
      manager,
      request,
      environment.deployment.inputPackageRef,
      "INPUT_PACKAGE",
    );
    if (
      validateInputPackage008(input.document, "N2").status !== "PASS" ||
      !Array.isArray(input.document.entries)
    )
      return reject("PILOT_COHORT_REVIEW_BINDING_REQUIRED", 409);
    const matches = (input.document.entries as unknown[]).filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).id === "IN-10",
    );
    if (
      matches.length !== 1 ||
      !matches[0] ||
      typeof matches[0] !== "object" ||
      Array.isArray(matches[0])
    )
      return reject("PILOT_COHORT_REVIEW_BINDING_REQUIRED", 409);
    const metadata = (matches[0] as Record<string, unknown>).metadata;
    if (!matchesReviewedCohort(metadata, cohort))
      return reject("PILOT_COHORT_REVIEW_BINDING_REQUIRED", 409);
    const rows = (await manager.query(
      `SELECT instance_id FROM pilot_runtime_registrations WHERE instance_id=$1 AND workspace_id=$2
       AND deployment_id=$3 AND deployment_version=$4 AND component='worker' AND state='ACTIVE'
       AND expires_at>clock_timestamp() AND config_digest=$5 AND image_digest=$6 FOR SHARE`,
      [
        candidate.pilotFence.fence.runtimeInstanceId,
        request.workspaceId,
        environment.deployment.deploymentId,
        environment.deployment.version,
        pilotContentHash(environment.deployment),
        environment.deployment.imageDigest,
      ],
    )) as unknown[];
    if (rows.length !== 1) return reject("PILOT_WORKER_FENCE_UNAVAILABLE", 409);
  }

  async prepare(
    request: OnboardingRequest,
    input: Readonly<{ expectedVersion: number; reason: string; details: PilotFenceActionDetails }>,
    key: string,
  ) {
    if (
      !input.details ||
      containsSensitiveValue008(input.details) ||
      JSON.stringify(input.details).length > 262_144
    )
      return reject("PILOT_FENCE_ACTION_INVALID", 400);
    await this.ready(request, input.details.fence.deploymentRef);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request);
      const authority = await authorizeAdministrative(
        manager,
        request,
        "project.onboarding.activate",
        "system-administrator",
        true,
      );
      return await command(
        manager,
        request,
        authority.actor.principalId,
        "pilot.fence.prepare",
        key,
        input,
        async () => {
          if (
            current.version !== input.expectedVersion ||
            current.stage !== "PILOT_ACTIVE" ||
            current.operationalState !== "ACTIVE"
          )
            return reject("PILOT_ONBOARDING_CHANGED", 409);
          const now = new Date();
          const base = {
            actionId: randomUUID(),
            workspaceId: request.workspaceId,
            projectId: request.projectId,
            expectedOnboardingVersion: current.version,
            initiator: authority.human,
            reason: input.reason,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 300_000).toISOString(),
          };
          const details = structuredClone(input.details);
          const cohortRecord = pilotFenceCohortRecord(base, details);
          const fixed = {
            ...details,
            fence: {
              ...details.fence,
              cohortRef: {
                id: details.cohortId,
                version: 1,
                contentHash: cohortRecord.contentHash as `sha256:${string}`,
              },
            },
          };
          const candidate = createPilotFenceAction(base, fixed);
          await this.verifyInputs(manager, request, candidate, current);
          await this.ready(request, candidate.pilotFence.fence.deploymentRef);
          await saveOperationalCandidate(manager, candidate);
          const candidateRef = ref(candidate.actionId, 1, candidate.contentHash);
          await auditAndEvent(
            manager,
            request,
            authority,
            "PILOT_FENCE_PUBLICATION_REQUESTED",
            candidateRef,
            input.reason,
          );
          await request.authorize("project.onboarding.activate");
          return { status: "PENDING_APPROVAL" as const, resultRef: candidateRef, candidate };
        },
      );
    });
  }

  async publish(
    request: OnboardingRequest,
    input: Readonly<{
      expectedVersion: number;
      candidateRef: ExactRevisionRef;
      approvalRef: ExactRevisionRef;
    }>,
    key: string,
  ) {
    await request.authorize("project.onboarding.activate");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const current = await lockOnboarding(manager, request);
      const authority = await authorizeAdministrative(
        manager,
        request,
        "project.onboarding.activate",
        "system-administrator",
        true,
      );
      return await command(
        manager,
        request,
        authority.actor.principalId,
        "pilot.fence.publish",
        key,
        input,
        async () => {
          const candidate = (await loadOperationalCandidate(
            manager,
            request,
            input.candidateRef,
          )) as PilotFenceAction;
          if (
            candidate.kind !== "PILOT_FENCE_PUBLISH" ||
            current.version !== input.expectedVersion ||
            candidate.expectedOnboardingVersion !== current.version ||
            candidate.initiator.principalId !== authority.actor.principalId
          )
            return reject("PILOT_FENCE_ACTION_INVALID", 409);
          await this.verifyInputs(manager, request, candidate, current);
          await this.ready(request, candidate.pilotFence.fence.deploymentRef);
          const duplicates = (await manager.query(
            "SELECT record_id FROM pilot_record_headers WHERE workspace_id=$1 AND project_id=$2 AND kind='FENCE' FOR UPDATE",
            [request.workspaceId, request.projectId],
          )) as unknown[];
          if (duplicates.length) return reject("PILOT_FENCE_ALREADY_EXISTS", 409);
          await consumeOperationalApproval(
            manager,
            request,
            candidate,
            input.approvalRef,
            current.version,
          );
          const repo = new PilotRepository(this.source);
          await repo.publish(pilotFenceCohortRecord(candidate, candidate.pilotFence), 0, manager);
          const recordBody = {
            id: candidate.pilotFence.fenceId,
            version: 1,
            schemaVersion: 1 as const,
            kind: "FENCE" as const,
            workspaceId: request.workspaceId,
            projectId: request.projectId,
            actorRef: authority.actor.principalId,
            correlationId: candidate.actionId,
            createdAt: candidate.createdAt,
            body: candidate.pilotFence.fence as unknown as PilotRecord["body"],
          };
          const record: PilotRecord = { ...recordBody, contentHash: pilotContentHash(recordBody) };
          await repo.publish(record, 0, manager);
          await this.ready(request, candidate.pilotFence.fence.deploymentRef);
          const resultRef = ref(record.id, 1, record.contentHash as `sha256:${string}`);
          await manager.query(
            "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [request.workspaceId, request.projectId, candidate.actionId, { resultRef }],
          );
          await auditAndEvent(
            manager,
            request,
            authority,
            "PILOT_FENCE_PUBLISHED",
            resultRef,
            candidate.reason,
          );
          await request.authorize("project.onboarding.activate");
          return { status: "COMPLETED" as const, resultRef };
        },
      );
    });
  }
}
