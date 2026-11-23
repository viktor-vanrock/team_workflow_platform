import { HttpException } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import { defaultClassificationCatalog } from "@awp/platform-core";

import {
  authorizeQaApi,
  type QaInteractionSession,
  qaInteractionSession,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import { currentAuthority, digest, object, reject, uuid } from "./durable-http.ts";

type Query = Readonly<{
  q?: string | undefined;
  limit?: string | undefined;
  cursor?: string | undefined;
}>;
const unavailable = () => reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
const eventTypes = [
  "PROJECT_REGISTERED",
  "PROJECT_ONBOARDING_CHANGED",
  "PROJECT_ENTITLEMENTS_CHANGED",
  "PROJECT_BINDING_CHANGED",
  "PROJECT_OPERATIONAL_STATE_CHANGED",
];

/** Current membership/role/entitlement decisions precede business lookup and pagination. */
export class DurableProjectReadsApplication {
  constructor(private readonly source: DataSource) {}
  private async grants(
    manager: EntityManager,
    workspaceId: string,
    session: QaInteractionSession,
    permission: string,
    request: QaSessionRequest,
  ) {
    const active = (await manager.query(
      "SELECT m.id FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id AND w.state='ACTIVE' WHERE m.workspace_id=$1 AND m.principal_id=$2 AND m.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) FOR SHARE OF m,w",
      [workspaceId, session.principalId],
    )) as unknown[];
    if (!active.length) return unavailable();
    const candidates = (await manager.query(
      "SELECT DISTINCT project_id FROM project_entitlements WHERE workspace_id=$1 AND principal_id=$2 AND effect='ALLOW' AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND (permissions ? $3 OR permissions ? '*') ORDER BY project_id",
      [workspaceId, session.principalId, permission],
    )) as { project_id: string }[];
    const grants = [];
    for (const { project_id: projectId } of candidates) {
      try {
        const identity = await authorizeQaApi(
          this.source,
          request,
          workspaceId,
          projectId,
          permission,
        );
        if (identity.actor.principalId !== session.principalId) return unavailable();
        const access = await currentAuthority(
          manager,
          { kind: "PROJECT", workspaceId, projectId },
          session.principalId,
          permission,
        );
        const ceiling =
          defaultClassificationCatalog.reference(identity.classificationCeiling).rank <
          defaultClassificationCatalog.reference(access.classificationCeiling).rank
            ? identity.classificationCeiling
            : access.classificationCeiling;
        if (
          !defaultClassificationCatalog.permits(
            defaultClassificationCatalog.reference(ceiling),
            defaultClassificationCatalog.reference(access.classification),
          )
        )
          continue;
        grants.push({ projectId, basis: access.basis, ceiling });
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 403) continue;
        throw error;
      }
    }
    return grants;
  }
  private page<T>(items: readonly T[], query: Query, binding: unknown) {
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return reject("PROJECT_READ_LIMIT_INVALID", 400);
    const fingerprint = digest({ binding, items });
    let offset = 0;
    if (query.cursor !== undefined) {
      let cursor: Record<string, unknown>;
      try {
        if (query.cursor.length > 1024) throw new Error();
        cursor = object(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")), [
          "fingerprint",
          "offset",
        ]);
      } catch {
        return reject("PROJECT_READ_CURSOR_INVALID", 400);
      }
      if (
        cursor.fingerprint !== fingerprint ||
        !Number.isSafeInteger(cursor.offset) ||
        Number(cursor.offset) < 0
      )
        return reject("PROJECT_READ_CURSOR_STALE", 409);
      offset = Number(cursor.offset);
    }
    const selected = items.slice(offset, offset + limit);
    return {
      items: selected,
      visibleCount: selected.length,
      ...(offset + limit < items.length
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ fingerprint, offset: offset + limit }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
  async search(request: QaSessionRequest, workspaceId: string, query: Query) {
    uuid(workspaceId);
    const session = await qaInteractionSession(request),
      q = (query.q ?? "").trim().toLowerCase();
    if (q.length > 256) return reject("PROJECT_SEARCH_QUERY_INVALID", 400);
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      const grants = await this.grants(
        manager,
        workspaceId,
        session,
        "project.catalog.read",
        request,
      );
      const items = (await manager.query(
        'SELECT id AS "projectId",key,name,classification_key AS "classificationKey" FROM projects WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND (strpos(lower(name),$3)>0 OR strpos(lower(key),$3)>0) ORDER BY key COLLATE "C",id',
        [workspaceId, grants.map((g) => g.projectId), q],
      )) as { projectId: string }[];
      return this.page(items, query, {
        surface: "search",
        workspaceId,
        principalId: session.principalId,
        q,
        grants,
      });
    });
  }
  async events(request: QaSessionRequest, workspaceId: string, query: Query) {
    uuid(workspaceId);
    const session = await qaInteractionSession(request);
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      const grants = await this.grants(
        manager,
        workspaceId,
        session,
        "project.onboarding.read",
        request,
      );
      // Only safe onboarding notifications are public. Outbox payloads, actors and internal job metadata stay private.
      const items = (await manager.query(
        `SELECT id AS "eventId",project_id AS "projectId",event_type AS "eventType",created_at AS "occurredAt" FROM event_outbox
        WHERE workspace_id=$1 AND project_id=ANY($2::uuid[]) AND event_type=ANY($3::text[])
          AND envelope->'payload'->'scope'->>'workspaceId'=workspace_id::text
          AND envelope->'payload'->'scope'->>'projectId'=project_id::text
          AND envelope->'payload'->>'eventId'=id::text
        ORDER BY created_at,id`,
        [workspaceId, grants.map((g) => g.projectId), eventTypes],
      )) as { eventId: string; projectId: string }[];
      return this.page(items, query, {
        surface: "events",
        workspaceId,
        principalId: session.principalId,
        grants,
      });
    });
  }
  async workItem(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ) {
    uuid(workspaceId);
    uuid(projectId);
    uuid(workItemId);
    const session = await qaInteractionSession(request);
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      let access, ceilingRank;
      try {
        const identity = await authorizeQaApi(
          this.source,
          request,
          workspaceId,
          projectId,
          "work-item.read",
        );
        if (identity.actor.principalId !== session.principalId) return unavailable();
        access = await currentAuthority(
          manager,
          { kind: "PROJECT", workspaceId, projectId },
          session.principalId,
          "work-item.read",
        );
        ceilingRank = Math.min(
          defaultClassificationCatalog.reference(identity.classificationCeiling).rank,
          defaultClassificationCatalog.reference(access.classificationCeiling).rank,
        );
        if (defaultClassificationCatalog.reference(access.classification).rank > ceilingRank)
          return unavailable();
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 403) return unavailable();
        throw error;
      }
      const [item] = (await manager.query(
        `SELECT w.id,w.workspace_id AS "workspaceId",w.project_id AS "projectId",w.state,w.classification_key AS "classificationKey",w.row_version AS version
        FROM work_items w JOIN classification_catalog c ON c.key=w.classification_key WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3 AND c.rank<=$4`,
        [workspaceId, projectId, workItemId, ceilingRank],
      )) as Record<string, unknown>[];
      return item ?? unavailable();
    });
  }
}
