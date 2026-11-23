import type { EntityManager } from "typeorm";

import {
  type JsonValue,
  type ManualSessionAdmissionHook,
  type QaAdjudicativeMutationInvalidatorContribution,
  QaAdjudicativeMutationInvalidatorRegistry,
  QaArtifactReferenceAdapter,
  type QaBindingHealth,
  type QaBindingHealthPort,
  type QaCurrentOperationalProjectionPort,
  type QaExactActionCandidate,
  QaExactActionClient,
  type QaGenericArtifactMetadata,
  type QaOperationalProjection,
  type QaPlatformActionPort,
  type QaProjectRegistryPort,
  type QaProjectRegistryStatus,
  qaScopeFromContext,
  type QaTestSession,
  type QaWorkspaceContext,
} from "@awp/competency-qa/node";
import { type JsonValue as ContractJsonValue, sha256 } from "@awp/platform-contracts";
import {
  type ArtifactService,
  type IntegrationConfigurationQueryPort,
  type OperationalProjectionQueryPort,
  type PlatformActionPort,
  type ProjectRegistryQueryPort,
  projectSafeQueueAuthorizationWitness,
  type WorkspaceContext,
} from "@awp/platform-core";

import {
  PostgresCapacityAdmissionBinder,
  type PostgresCapacityAdmissionBinderPorts,
} from "../queue/admission-service.ts";

const runtimeRows = (value: unknown): readonly Record<string, unknown>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Record<string, unknown>[];
};
const runtimeJson = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const runtimeUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Transaction-bound bridge from a QA Session transition to Core capacity. */
export class RuntimeQaManualSessionAdmissionAdapter implements ManualSessionAdmissionHook {
  constructor(
    private readonly manager: EntityManager,
    private readonly context: Readonly<{
      actor: Readonly<{ kind: "HUMAN"; principalId: string; issuer: string; subject: string }>;
      authorizationBasis: unknown;
      correlationId: string;
      causationId: string;
      overrideIntent?: Readonly<{ reason: string; expiresAt: string }>;
      requestKey?: string;
      resolveExactOverride?: PostgresCapacityAdmissionBinderPorts["resolveExactOverride"];
    }>,
  ) {}

  async admit(previous: QaTestSession, next: QaTestSession) {
    const projection = runtimeRows(
      await this.manager.query(
        `SELECT revision.stage,revision.control_facet,revision.operational_facet,revision.qa_facet,
              revision.policy_facet_ref,revision.source_set_hash
         FROM queue_entry_heads head
         JOIN queue_entry_revisions revision ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id AND revision.queue_entry_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 AND head.suppressed_by_work_item_id IS NULL`,
        [next.workspaceId, next.projectId, next.workItemId],
      ),
    )[0];
    if (!projection) throw new Error("QUEUE_ENTRY_REQUIRED_FOR_MANUAL_ADMISSION");
    const operational = runtimeJson<Record<string, unknown>>(projection.operational_facet);
    const control = runtimeJson<Record<string, unknown>>(projection.control_facet);
    const qa = runtimeJson<Record<string, unknown>>(projection.qa_facet);
    const policyFacetRef = runtimeJson<
      Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>
    >(projection.policy_facet_ref);
    if (operational.state !== "KNOWN" || !operational.projectionRef)
      throw new Error("CONFIRMED_OPERATIONAL_PROJECTION_REQUIRED_FOR_MANUAL_ADMISSION");
    const requiredPermission = "queue.work-admit";
    const authorizationScopeWitness = projectSafeQueueAuthorizationWitness(
      { kind: "PROJECT", workspaceId: next.workspaceId, projectId: next.projectId },
      {
        workspaceId: next.workspaceId,
        projectId: next.projectId,
        requiredPermission,
        classificationDecision: "ALLOW",
      },
      next.startedAt ?? new Date().toISOString(),
    );
    const authorizationScopeWitnessHash = sha256({
      workspaceId: next.workspaceId,
      projectId: next.projectId,
      requiredPermission,
      classificationDecision: "ALLOW",
    } as ContractJsonValue);
    const resumingConsumingState =
      previous.state === "BLOCKED" &&
      (previous.blockedFrom === "RUNNING" || previous.blockedFrom === "REVIEW_REQUIRED");
    const previousSessionRef = Object.freeze({
      sourceType: "QA_TEST_SESSION_REVISION" as const,
      sourceId: previous.id,
      sourceVersion: previous.resourceVersion,
      semanticHash: sha256(previous as unknown as ContractJsonValue),
    });
    const committedSessionRef = Object.freeze({
      sourceType: "QA_TEST_SESSION_REVISION" as const,
      sourceId: next.id,
      sourceVersion: next.resourceVersion,
      semanticHash: sha256(next as unknown as ContractJsonValue),
    });
    const binder = new PostgresCapacityAdmissionBinder(this.manager.dataSource, {
      reauthorize: async (manager, input) => {
        const basis = this.context.authorizationBasis as Readonly<{
          kind?: string;
          membershipRef?: Readonly<{ id: string; version: number }>;
          entitlementRefs?: readonly Readonly<{ id: string }>[];
        }>;
        if (basis.kind !== "PROJECT" || !basis.membershipRef || !basis.entitlementRefs?.length)
          return false;
        const authorized = runtimeRows(
          await manager.query(
            `SELECT 1 FROM workspace_memberships membership
             JOIN projects project ON project.workspace_id=membership.workspace_id AND project.id=$3 AND project.state='ACTIVE'
            WHERE membership.workspace_id=$1 AND membership.principal_id=$2 AND membership.id=$4 AND membership.row_version=$5
              AND membership.state='ACTIVE' AND membership.revoked_at IS NULL
              AND EXISTS(SELECT 1 FROM project_entitlements entitlement
                WHERE entitlement.workspace_id=$1 AND entitlement.project_id=$3 AND entitlement.principal_id=$2
                  AND entitlement.id=ANY($6::uuid[]) AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL)`,
            [
              input.workspaceId,
              input.principalId,
              input.projectId,
              basis.membershipRef.id,
              basis.membershipRef.version,
              basis.entitlementRefs.map(({ id }) => id),
            ],
          ),
        );
        return authorized.length === 1;
      },
      ...(this.context.resolveExactOverride
        ? { resolveExactOverride: this.context.resolveExactOverride }
        : {}),
    });
    return await binder.admitInTransaction(this.manager, {
      workspaceId: next.workspaceId,
      projectId: next.projectId,
      workItemId: next.workItemId,
      sessionId: next.id,
      principalId: this.context.actor.principalId,
      requestKey:
        this.context.requestKey ??
        `qa-session:${next.id}:${previous.resourceVersion}:${next.state}`,
      activityKind: resumingConsumingState ? "MANUAL_SESSION_RESUME" : "MANUAL_SESSION_START",
      ...(resumingConsumingState
        ? { blockedFromState: previous.blockedFrom as "RUNNING" | "REVIEW_REQUIRED" }
        : {}),
      actor: this.context.actor,
      approvalInitiator: this.context.actor,
      authorizationScopeWitnessHash,
      authorizationScopeWitness,
      initiatorAuthorizationBasis: this.context.authorizationBasis as ContractJsonValue,
      expectedState: Object.freeze({
        policyFacetRef,
        expectedQueueControlVersion: Number(control.resourceVersion ?? 0),
        operationalProjectionRef: operational.projectionRef as Readonly<
          Record<string, ContractJsonValue>
        >,
        qaSourceSetHash: String(
          (qa.factsRef as Record<string, unknown> | undefined)?.semanticHash ??
            projection.source_set_hash,
        ) as `sha256:${string}`,
        sessionRef: previousSessionRef,
      }),
      committedSessionRef,
      authorizedScopeSnapshotRef: Object.freeze({
        id: runtimeUuid(
          `authorized-capacity-scope:${next.workspaceId}:${next.projectId}:${authorizationScopeWitnessHash}`,
        ),
        version: 1,
        semanticHash: authorizationScopeWitnessHash,
      }),
      decidedAt: next.startedAt ?? new Date().toISOString(),
      correlationId: this.context.correlationId,
      causationId: this.context.causationId,
      ...(this.context.overrideIntent ? { overrideIntent: this.context.overrideIntent } : {}),
    });
  }
}

export class RuntimeQaProjectRegistryAdapter implements QaProjectRegistryPort {
  constructor(private readonly projects: ProjectRegistryQueryPort) {}

  async current(context: QaWorkspaceContext): Promise<QaProjectRegistryStatus | undefined> {
    const scope = qaScopeFromContext(context);
    return await this.projects.projectRegistryStatus(scope.workspaceId, scope.projectId);
  }
}

export class RuntimeQaOperationalProjectionAdapter implements QaCurrentOperationalProjectionPort {
  constructor(private readonly projections: OperationalProjectionQueryPort) {}

  async current(
    context: QaWorkspaceContext,
    workItemId: string,
  ): Promise<QaOperationalProjection | undefined> {
    const scope = qaScopeFromContext(context);
    return await this.projections.operationalProjection(
      scope.workspaceId,
      scope.projectId,
      workItemId,
    );
  }
}

export class RuntimeQaBindingHealthAdapter implements QaBindingHealthPort {
  constructor(private readonly integrations: IntegrationConfigurationQueryPort) {}

  async current(
    context: QaWorkspaceContext,
    bindingRef: Readonly<{ id: string; version: number }>,
  ): Promise<QaBindingHealth | undefined> {
    const scope = qaScopeFromContext(context);
    return await this.integrations.bindingHealth(scope.workspaceId, scope.projectId, bindingRef);
  }
}

export interface RuntimeQaArtifactMetadataRefresher {
  refreshArtifactMetadata(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    artifactReferenceId: string,
  ): Promise<void>;
}

export function composeQaPlatformAdapters<TSubject extends JsonValue, TResult>(
  options: Readonly<{
    projectRegistry: ProjectRegistryQueryPort;
    operationalProjections: OperationalProjectionQueryPort;
    integrations: IntegrationConfigurationQueryPort;
    artifacts: ArtifactService;
    artifactMetadataRefresher?: RuntimeQaArtifactMetadataRefresher;
    platformActions: PlatformActionPort<QaExactActionCandidate<TSubject>, TResult>;
    invalidators?: readonly QaAdjudicativeMutationInvalidatorContribution[];
  }>,
) {
  const artifactMetadata = {
    getArtifactMetadata: async (
      context: QaWorkspaceContext,
      artifactId: string,
    ): Promise<QaGenericArtifactMetadata> => {
      const platformContext = context as unknown as WorkspaceContext;
      const current = await options.artifacts.getArtifactMetadata(platformContext, artifactId);
      if (current.storageProviderKind !== "GITLAB_CI" || !options.artifactMetadataRefresher)
        return current;
      await options.artifactMetadataRefresher.refreshArtifactMetadata(
        qaScopeFromContext(context),
        artifactId,
      );
      return await options.artifacts.getArtifactMetadata(platformContext, artifactId);
    },
  };
  return Object.freeze({
    projectRegistry: new RuntimeQaProjectRegistryAdapter(options.projectRegistry),
    operationalProjections: new RuntimeQaOperationalProjectionAdapter(
      options.operationalProjections,
    ),
    bindingHealth: new RuntimeQaBindingHealthAdapter(options.integrations),
    artifactReferences: new QaArtifactReferenceAdapter(artifactMetadata),
    exactActions: new QaExactActionClient<TSubject, TResult>(
      options.platformActions as QaPlatformActionPort<QaExactActionCandidate<TSubject>, TResult>,
    ),
    mutationInvalidators: new QaAdjudicativeMutationInvalidatorRegistry(options.invalidators ?? []),
  });
}
