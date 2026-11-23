import type { DataSource } from "typeorm";

import { DenyByDefaultAuthorizationPolicy } from "@awp/platform-core";
import { TypeOrmScopedAccessRepository } from "@awp/platform-persistence-typeorm";

import { loadEnvironment } from "../config/environment.ts";
import type { QueueApprovalAuthorizer } from "../queue/approval-api.ts";
import type { QueueHttpAuthority, QueueRuntimeRequest } from "../queue/http-authority.ts";
import { PostgresAuthorizedQueueProjects } from "../queue/portfolio-query.ts";
import { localPersonaCatalog } from "./local-security.ts";

/** Explicit adapter for the guarded local-persona composition. */
export class LocalQueueHttpAuthority implements QueueHttpAuthority {
  constructor(
    private readonly source: DataSource,
    private readonly authorizer: QueueApprovalAuthorizer,
  ) {}
  private persona(request: QueueRuntimeRequest) {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QUEUE_AUTHORITY_FORBIDDEN");
    const key = (request as { localPersonaKey?: string }).localPersonaKey;
    if (!key) throw new Error("QA_IDENTITY_REQUIRED");
    const persona = localPersonaCatalog.resolve(key);
    if (persona.kind !== "HUMAN") throw new Error("QA_PERMISSION_DENIED");
    return persona;
  }
  async project(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ) {
    const persona = this.persona(request);
    const authorized = await this.authorizer.authorize({
      workspaceId,
      projectId,
      actorSubject: persona.subject,
      permission,
    });
    if (!authorized) throw new Error("QA_SCOPE_DENIED");
    return authorized;
  }
  async workspace(request: QueueRuntimeRequest, workspaceId: string, permission: string) {
    const persona = this.persona(request);
    const rows = (await this.source.query(
      `SELECT i.id FROM identities i JOIN workspace_memberships m ON m.principal_id=i.id AND m.workspace_id=$1
      AND m.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())
      WHERE i.issuer=$2 AND i.subject=$3`,
      [workspaceId, loadEnvironment().identityIssuer, persona.subject],
    )) as readonly { id: string }[];
    if (rows.length !== 1) throw new Error("QA_SCOPE_DENIED");
    const scope = { kind: "WORKSPACE" as const, workspaceId };
    const actor = {
      kind: "HUMAN" as const,
      principalId: rows[0]!.id,
      issuer: loadEnvironment().identityIssuer,
      subject: persona.subject,
    };
    const at = new Date();
    const facts = await new TypeOrmScopedAccessRepository(this.source).authorizationFacts(
      scope,
      actor.principalId,
      at,
    );
    const decision = new DenyByDefaultAuthorizationPolicy().decide({
      context: { actor, scope, correlationId: "queue-workspace", causationId: "queue-workspace" },
      permission,
      resourceClassification: { key: "INTERNAL", rank: 10 },
      facts,
      at,
    });
    if (!decision.allowed) throw new Error("QA_PERMISSION_DENIED");
    return {
      kind: "HUMAN" as const,
      principalId: rows[0]!.id,
      issuer: loadEnvironment().identityIssuer,
      subject: persona.subject,
    };
  }
  async portfolio(
    request: QueueRuntimeRequest,
    workspaceId: string,
    permissions: readonly string[],
  ) {
    const persona = this.persona(request);
    await this.workspace(request, workspaceId, "queue.portfolio.read");
    const resolved = await new PostgresAuthorizedQueueProjects(this.source).resolveIdentity({
      workspaceId,
      issuer: loadEnvironment().identityIssuer,
      subject: persona.subject,
      permissions,
    });
    const projectIds: string[] = [];
    for (const projectId of resolved.projectIds) {
      try {
        for (const permission of new Set([
          "queue.project.read",
          ...permissions.filter((value) => value !== "queue.portfolio.read"),
        ])) {
          const current = await this.authorizer.authorize({
            workspaceId,
            projectId,
            actorSubject: persona.subject,
            permission,
          });
          if (!current || current.actor.principalId !== resolved.principalId)
            throw new Error("QA_SCOPE_DENIED");
        }
        projectIds.push(projectId);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["QA_SCOPE_DENIED", "QA_PERMISSION_DENIED", "QA_IDENTITY_REQUIRED"].includes(
            error.message,
          )
        )
          throw error;
      }
    }
    return Object.freeze({
      principalId: resolved.principalId,
      projectIds: Object.freeze(projectIds),
    });
  }
}
