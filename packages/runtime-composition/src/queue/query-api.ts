import type { DataSource } from "typeorm";

import {
  authorizedProjectSetHash,
  defaultClassificationCatalog,
  type ProjectQueuePolicyFacet,
  type PublicCapacitySnapshot,
  type QueueVersionedContentRef,
  validateCapacitySnapshot,
} from "@awp/platform-core";
import {
  CapacityScopeProjectionRepository,
  SlaClockRepository,
} from "@awp/platform-persistence-typeorm";

import type { QueueApprovalAuthorization } from "./approval-api.ts";
import type { QueueHttpAuthority, QueueRuntimeRequest } from "./http-authority.ts";
import {
  exactQueueEntryReadToken,
  PostgresProjectQueueProjection,
  ProjectQueueQueryService,
  ProjectSlaQueryService,
  queuePageEtag,
} from "./portfolio-query.ts";
import { PostgresBusinessCalendarRevisionReader } from "./temporal-transition-worker.ts";

export type { QueueRuntimeRequest } from "./http-authority.ts";
export interface QueueRuntimeResponse {
  setHeader(name: string, value: string): void;
}
type Row = Readonly<Record<string, unknown>>;
const resultRows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  if (!Array.isArray(raw)) return Object.freeze([]);
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

function queueReadError(error: unknown): never {
  throw error;
}

function scopedProjection(
  source: DataSource,
  authority: QueueHttpAuthority,
  request: QueueRuntimeRequest,
) {
  return new PostgresProjectQueueProjection(
    source,
    async ({ workspaceId, projectId, principalId }) => {
      const authorization = await authority.project(
        request,
        workspaceId,
        projectId,
        "queue.project.read",
      );
      if (authorization.actor.principalId !== principalId) throw new Error("QA_SCOPE_DENIED");
      return authorization.classificationCeiling === undefined
        ? undefined
        : defaultClassificationCatalog.reference(authorization.classificationCeiling).rank;
    },
  );
}

export class RuntimeQueueApi {
  constructor(
    private readonly source: DataSource,
    private readonly authority: QueueHttpAuthority,
  ) {}

  private async authorize(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ): Promise<QueueApprovalAuthorization> {
    const authorization = await this.authority.project(request, workspaceId, projectId, permission);
    if (!authorization) throw new Error("QA_SCOPE_DENIED");
    return authorization;
  }

  private async readAuthorization(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
    hiddenReason: string,
  ) {
    try {
      return await this.authorize(request, workspaceId, projectId, permission);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("QA_")) throw new Error(hiddenReason);
      throw error;
    }
  }

  private service(request: QueueRuntimeRequest): ProjectQueueQueryService {
    return new ProjectQueueQueryService({
      authorize: async ({ workspaceId, projectId }) => {
        try {
          await this.authorize(request, workspaceId, projectId, "queue.project.read");
          return true;
        } catch (error) {
          if (error instanceof Error && error.message === "QA_SCOPE_DENIED") return false;
          throw error;
        }
      },
      projection: scopedProjection(this.source, this.authority, request),
    });
  }

  private slaService(request: QueueRuntimeRequest): ProjectSlaQueryService {
    const clocks = new SlaClockRepository(this.source);
    const calendars = new PostgresBusinessCalendarRevisionReader(this.source);
    const policy = async (
      workspaceId: string,
      projectId: string,
      ref?: QueueVersionedContentRef,
    ): Promise<ProjectQueuePolicyFacet | undefined> => {
      const found = resultRows(
        await this.source.query(
          `SELECT revision.safe_body FROM project_queue_policy_facet_heads head
           JOIN project_queue_policy_facet_revisions revision
             ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
            AND revision.policy_facet_id=head.policy_facet_id
            ${ref ? "" : "AND revision.policy_facet_revision_id=head.current_revision_id"}
          WHERE head.workspace_id=$1 AND head.project_id=$2
            ${ref ? "AND revision.policy_facet_id=$3 AND revision.revision_number=$4 AND revision.semantic_hash=$5" : "ORDER BY head.updated_at DESC LIMIT 1"}`,
          ref
            ? [workspaceId, projectId, ref.id, ref.version, ref.semanticHash]
            : [workspaceId, projectId],
        ),
      );
      return found[0] ? json<ProjectQueuePolicyFacet>(found[0].safe_body) : undefined;
    };
    return new ProjectSlaQueryService({
      authorize: async ({ workspaceId, projectId }) => {
        try {
          await this.authorize(request, workspaceId, projectId, "queue.sla.read");
          return true;
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("QA_")) return false;
          throw error;
        }
      },
      workItemExists: async ({ workspaceId, projectId, workItemId }) =>
        resultRows(
          await this.source.query(
            "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, projectId, workItemId],
          ),
        ).length === 1,
      currentPolicyFacet: async ({ workspaceId, projectId }) =>
        await policy(workspaceId, projectId),
      policyFacetByRef: async ({ workspaceId, projectId }, ref) =>
        await policy(workspaceId, projectId, ref),
      calendarByRef: async (workspaceId, ref) => await calendars.read(workspaceId, ref),
      currentClock: async ({ workspaceId, projectId, workItemId }, goal) =>
        await clocks.currentClock({ kind: "PROJECT", workspaceId, projectId }, workItemId, goal),
      openSegment: async ({ workspaceId, projectId }, slaClockId) =>
        (await clocks.segmentHistory({ kind: "PROJECT", workspaceId, projectId }, slaClockId)).find(
          ({ endedAt }) => endedAt === undefined,
        ),
      freshness: async ({ workspaceId, projectId, workItemId }) => {
        const found = resultRows(
          await this.source.query(
            `SELECT binding.freshness_state FROM work_items item
             JOIN operational_bindings binding
               ON binding.workspace_id=item.workspace_id AND binding.project_id=item.project_id
              AND binding.id=item.operational_binding_id
            WHERE item.workspace_id=$1 AND item.project_id=$2 AND item.id=$3`,
            [workspaceId, projectId, workItemId],
          ),
        );
        const state = String(found[0]?.freshness_state ?? "UNKNOWN");
        return state === "CURRENT" ? "CURRENT" : state === "STALE" ? "STALE" : "ERROR";
      },
    });
  }

  async lane(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    stage: string | undefined,
    serviceClass: string | undefined,
    freshness: string | undefined,
    rawPageSize: string | undefined,
    cursor: string | undefined,
    response: QueueRuntimeResponse,
  ) {
    try {
      const authorization = await this.readAuthorization(
        request,
        workspaceId,
        projectId,
        "queue.project.read",
        "QUEUE_PROJECT_NOT_FOUND",
      );
      const page = await this.service(request).lane({
        workspaceId,
        projectId,
        principalId: authorization.actor.principalId,
        ...(stage ? { stage } : {}),
        ...(serviceClass ? { serviceClass } : {}),
        ...(freshness ? { freshness } : {}),
        ...(rawPageSize ? { pageSize: Number(rawPageSize) } : {}),
        ...(cursor ? { cursor } : {}),
      });
      response.setHeader("ETag", queuePageEtag(page));
      return page;
    } catch (error) {
      queueReadError(error);
    }
  }

  async item(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
    response: QueueRuntimeResponse,
  ) {
    const authorization = await this.readAuthorization(
      request,
      workspaceId,
      projectId,
      "queue.project.read",
      "QUEUE_ITEM_NOT_FOUND",
    );
    const entry = await this.service(request).item({
      workspaceId,
      projectId,
      workItemId,
      principalId: authorization.actor.principalId,
    });
    const token = exactQueueEntryReadToken(entry);
    response.setHeader("ETag", `"${token.semanticHash}"`);
    response.setHeader("X-Queue-Entry-Revision", String(token.revision));
    response.setHeader("X-Queue-Control-Resource-Version", String(token.controlResourceVersion));
    return entry;
  }

  async sla(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
    response: QueueRuntimeResponse,
  ) {
    const authorization = await this.readAuthorization(
      request,
      workspaceId,
      projectId,
      "queue.sla.read",
      "QUEUE_ITEM_NOT_FOUND",
    );
    const result = await this.slaService(request).read({
      workspaceId,
      projectId,
      workItemId,
      principalId: authorization.actor.principalId,
    });
    response.setHeader("ETag", result.etag);
    return result.snapshots;
  }

  async capacity(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    response: QueueRuntimeResponse,
  ) {
    await this.authorize(request, workspaceId, projectId, "queue.capacity.read");
    const row = await new CapacityScopeProjectionRepository(
      this.source,
    ).currentAuthorizedProjection({ kind: "PROJECT", workspaceId, projectId }, [projectId]);
    if (!row) throw new Error("CAPACITY_PROJECTION_NOT_FOUND");
    const snapshot = row.safe_body as PublicCapacitySnapshot;
    validateCapacitySnapshot(snapshot);
    if (
      snapshot.scope.kind !== "PROJECT" ||
      snapshot.scope.workspaceId !== workspaceId ||
      snapshot.scope.projectId !== projectId
    ) {
      throw new Error("CAPACITY_PROJECTION_NOT_FOUND");
    }
    response.setHeader("ETag", `"${snapshot.authorizedProjectionRef.semanticHash}"`);
    response.setHeader(
      "X-Capacity-Projection-Revision",
      String(snapshot.authorizedProjectionRef.version),
    );
    return snapshot;
  }
}

export class RuntimePortfolioQueueApi {
  constructor(
    private readonly source: DataSource,
    private readonly authority: QueueHttpAuthority,
  ) {}

  async portfolio(
    request: QueueRuntimeRequest,
    workspaceId: string,
    stage: string | undefined,
    serviceClass: string | undefined,
    freshness: string | undefined,
    rawPageSize: string | undefined,
    cursor: string | undefined,
    response: QueueRuntimeResponse,
  ) {
    const resolved = await this.authority.portfolio(request, workspaceId, [
      "queue.portfolio.read",
      "queue.capacity.read",
    ]);
    const service = new ProjectQueueQueryService({
      authorize: async () => false,
      authorizedProjects: async () =>
        (
          await this.authority.portfolio(request, workspaceId, [
            "queue.portfolio.read",
            "queue.capacity.read",
          ])
        ).projectIds,
      projection: scopedProjection(this.source, this.authority, request),
    });
    try {
      const page = await service.portfolio({
        workspaceId,
        principalId: resolved.principalId,
        ...(stage ? { stage } : {}),
        ...(serviceClass ? { serviceClass } : {}),
        ...(freshness ? { freshness } : {}),
        ...(rawPageSize ? { pageSize: Number(rawPageSize) } : {}),
        ...(cursor ? { cursor } : {}),
      });
      response.setHeader("ETag", queuePageEtag(page));
      return page;
    } catch (error) {
      queueReadError(error);
    }
  }

  async capacity(
    request: QueueRuntimeRequest,
    workspaceId: string,
    response: QueueRuntimeResponse,
  ) {
    const resolved = await this.authority.portfolio(request, workspaceId, ["queue.portfolio.read"]);
    const scope = {
      kind: "AUTHORIZED_PORTFOLIO" as const,
      workspaceId,
      authorizedProjectSetHash: authorizedProjectSetHash(resolved.projectIds),
    };
    const row = await new CapacityScopeProjectionRepository(
      this.source,
    ).currentAuthorizedProjection(scope, resolved.projectIds);
    if (!row) throw new Error("CAPACITY_PROJECTION_NOT_FOUND");
    const snapshot = row.safe_body as PublicCapacitySnapshot;
    validateCapacitySnapshot(snapshot);
    if (
      snapshot.scope.kind !== "AUTHORIZED_PORTFOLIO" ||
      snapshot.scope.workspaceId !== workspaceId ||
      snapshot.authorizedProjectSetHash !== scope.authorizedProjectSetHash
    ) {
      throw new Error("CAPACITY_PROJECTION_NOT_FOUND");
    }
    response.setHeader("ETag", `"${snapshot.authorizedProjectionRef.semanticHash}"`);
    response.setHeader(
      "X-Capacity-Projection-Revision",
      String(snapshot.authorizedProjectionRef.version),
    );
    return snapshot;
  }
}
