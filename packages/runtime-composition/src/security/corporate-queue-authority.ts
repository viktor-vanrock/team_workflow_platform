import { assertProjectScope, freezePilotValue, type ProjectScope } from "@awp/platform-core";
import type { CorporateSessionRequest, CorporateSessionService } from "@awp/platform-runtime-nest";

import type { QueueHttpAuthority, QueueRuntimeRequest } from "../queue/http-authority.ts";

/** Project inventory narrows the deployment; every included Project still requires current Core authorization. */
export class CorporateQueueHttpAuthority implements QueueHttpAuthority {
  private readonly inventory: readonly ProjectScope[];
  private readonly stepUp: ReadonlySet<string>;
  constructor(
    private readonly sessions: CorporateSessionService,
    inventory: readonly ProjectScope[],
    stepUpPermissions: readonly string[],
  ) {
    if (
      !inventory.length ||
      inventory.length > 100 ||
      new Set(inventory.map(({ workspaceId, projectId }) => `${workspaceId}:${projectId}`)).size !==
        inventory.length
    )
      throw new Error("CORPORATE_QUEUE_POLICY_INVALID");
    inventory.forEach(assertProjectScope);
    this.inventory = freezePilotValue(structuredClone(inventory));
    this.stepUp = new Set(stepUpPermissions);
  }
  private input(
    request: QueueRuntimeRequest,
  ): CorporateSessionRequest & Readonly<{ method: string }> {
    const value = request as Partial<CorporateSessionRequest> & { method?: unknown };
    if (!value.headers || typeof value.headers !== "object" || typeof value.method !== "string")
      throw new Error("QA_SCOPE_DENIED");
    return value as CorporateSessionRequest & { method: string };
  }
  private operation(request: QueueRuntimeRequest) {
    return ["GET", "HEAD"].includes(this.input(request).method)
      ? ("READ" as const)
      : ("MUTATE" as const);
  }

  async project(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ) {
    try {
      if (
        !this.inventory.some(
          (scope) => scope.workspaceId === workspaceId && scope.projectId === projectId,
        )
      )
        throw new Error();
      const context = await this.sessions.authorize(this.input(request), {
        scope: { kind: "PROJECT", workspaceId, projectId },
        permission,
        operationClass: this.operation(request),
        requireStepUp: this.stepUp.has(permission),
      });
      if (context.actor.kind !== "HUMAN" || context.authorizationBasis?.kind !== "PROJECT")
        throw new Error();
      return { actor: context.actor, basis: context.authorizationBasis };
    } catch {
      throw new Error("QA_SCOPE_DENIED");
    }
  }
  async workspace(request: QueueRuntimeRequest, workspaceId: string, permission: string) {
    try {
      if (!this.inventory.some((scope) => scope.workspaceId === workspaceId)) throw new Error();
      const context = await this.sessions.authorize(this.input(request), {
        scope: { kind: "WORKSPACE", workspaceId },
        permission,
        operationClass: this.operation(request),
        requireStepUp: this.stepUp.has(permission),
      });
      if (context.actor.kind !== "HUMAN" || context.authorizationBasis?.kind !== "WORKSPACE")
        throw new Error();
      return context.actor;
    } catch {
      throw new Error("QA_SCOPE_DENIED");
    }
  }
  async portfolio(
    request: QueueRuntimeRequest,
    workspaceId: string,
    permissions: readonly string[],
  ) {
    try {
      if (!permissions.length) throw new Error();
      const first = await this.workspace(request, workspaceId, permissions[0]!);
      for (const permission of permissions.slice(1))
        if (
          (await this.workspace(request, workspaceId, permission)).principalId !== first.principalId
        )
          throw new Error();
      const projectIds: string[] = [];
      for (const candidate of this.inventory.filter((scope) => scope.workspaceId === workspaceId)) {
        try {
          // Portfolio membership is based on full rights, including explicit DENY and classification.
          const projectPermissions = new Set([
            "queue.project.read",
            ...permissions.filter((permission) => permission !== "queue.portfolio.read"),
          ]);
          for (const permission of projectPermissions) {
            const context = await this.sessions.authorize(this.input(request), {
              scope: { kind: "PROJECT", ...candidate },
              permission,
              operationClass: this.operation(request),
              requireStepUp: this.stepUp.has(permission),
            });
            if (
              context.actor.principalId !== first.principalId ||
              context.authorizationBasis?.kind !== "PROJECT"
            )
              throw new Error();
          }
          projectIds.push(candidate.projectId);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "PROJECT_RESOURCE_NOT_AVAILABLE")
            throw error;
        }
      }
      for (const permission of permissions)
        if (
          (await this.workspace(request, workspaceId, permission)).principalId !== first.principalId
        )
          throw new Error();
      return freezePilotValue({ principalId: first.principalId, projectIds: projectIds.sort() });
    } catch {
      throw new Error("QA_SCOPE_DENIED");
    }
  }
}
