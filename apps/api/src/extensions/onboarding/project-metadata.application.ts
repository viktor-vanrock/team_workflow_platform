import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  createOnboardingRevision,
  createProjectRegistryRevision,
  type ProjectRegistryRevision,
} from "@awp/platform-core";

import {
  appendOnboarding,
  auditAndEvent,
  authorizeAdministrative,
  command,
  digest,
  lockOnboarding,
  object,
  type OnboardingRequest,
  ref,
  reject,
  text,
  uuid,
  validHash,
} from "./durable-http.ts";
import { activeMember } from "./registry.application.ts";

export class ProjectMetadataApplication {
  constructor(private readonly source: DataSource) {}

  private async current(manager: EntityManager, request: OnboardingRequest) {
    const [row] = (await manager.query(
      "SELECT r.semantic_body,r.content_hash FROM projects p JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version WHERE p.workspace_id=$1 AND p.id=$2",
      [request.workspaceId, request.projectId],
    )) as { semantic_body: ProjectRegistryRevision; content_hash: string }[];
    if (!row) return reject("PROJECT_RESOURCE_NOT_AVAILABLE", 404);
    if (
      row.semantic_body.contentHash !== row.content_hash ||
      !validHash(row.semantic_body as unknown as { contentHash: string })
    )
      return reject("PROJECT_REGISTRY_UNVERIFIED", 503);
    return row.semantic_body;
  }

  async read(request: OnboardingRequest) {
    return this.source.transaction("REPEATABLE READ", async (manager) => {
      await authorizeAdministrative(manager, request, "project.metadata.update");
      const current = await this.current(manager, request);
      const ownerOptions = (await manager.query(
        `SELECT i.id,COALESCE(p.display_name,i.display_name,i.subject) AS "displayName" FROM workspace_memberships m JOIN identities i ON i.id=m.principal_id AND i.kind='HUMAN' LEFT JOIN platform_user_profiles p ON p.principal_id=i.id WHERE m.workspace_id=$1 AND m.state='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp()) ORDER BY "displayName",i.id`,
        [request.workspaceId],
      )) as { id: string; displayName: string }[];
      const rows = (await manager.query(
        "SELECT version,project_name,owner_ids,reason,created_by,created_at FROM project_registry_revisions WHERE workspace_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 51",
        [request.workspaceId, request.projectId],
      )) as {
        version: number;
        project_name: string;
        owner_ids: string[];
        reason: string;
        created_by: string | null;
        created_at: Date;
      }[];
      const ids = [
        ...new Set(rows.flatMap((r) => [...r.owner_ids, ...(r.created_by ? [r.created_by] : [])])),
      ];
      const people = (await manager.query(
        "SELECT i.id,COALESCE(p.display_name,i.display_name,i.subject) AS name FROM identities i LEFT JOIN platform_user_profiles p ON p.principal_id=i.id WHERE i.id=ANY($1::uuid[])",
        [ids],
      )) as { id: string; name: string }[];
      const names = new Map(people.map((p) => [p.id, p.name]));
      return {
        project: {
          id: request.projectId,
          workspaceId: request.workspaceId,
          key: current.key,
          name: current.name,
          dataClassificationKey: current.dataClassificationKey,
          ownerIds: current.ownerIds,
          version: current.version,
        },
        ownerOptions,
        history: rows.slice(0, 50).map((r) => ({
          version: r.version,
          name: r.project_name,
          ownerIds: r.owner_ids,
          owners: r.owner_ids.map((id) => names.get(id) ?? "Бывший участник"),
          actorName: names.get(r.created_by ?? "") ?? "Локальная начальная настройка",
          createdAt: r.created_at.toISOString(),
          reason: r.reason,
        })),
        historyLimit: 50,
        historyHasMore: rows.length > 50,
        resultRef: ref(current.revisionId, current.version, current.contentHash),
      };
    });
  }

  async update(request: OnboardingRequest, input: unknown, key: string, expectedVersion: number) {
    const b = object(input, ["name", "ownerIds", "reason"]);
    const name = text(b.name, 256),
      reason = text(b.reason, 2000);
    if (!Array.isArray(b.ownerIds) || b.ownerIds.length === 0 || b.ownerIds.length > 100)
      return reject("PROJECT_OWNERS_INVALID", 400);
    const ownerIds = b.ownerIds.map(uuid).sort();
    if (new Set(ownerIds).size !== ownerIds.length) return reject("PROJECT_OWNERS_INVALID", 400);
    const authentication = await request.authorize("project.metadata.update");
    const verifiedRequest = { ...request, authorize: async () => authentication };
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `project-onboarding:${request.workspaceId}`,
      ]);
      await manager.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        request.workspaceId,
      ]);
      const authority = await authorizeAdministrative(
        manager,
        verifiedRequest,
        "project.metadata.update",
        undefined,
        true,
      );
      return command(
        manager,
        request,
        authority.actor.principalId,
        "project.metadata.update",
        key,
        { name, ownerIds, reason, expectedVersion },
        async () => {
          const onboarding = await lockOnboarding(manager, request);
          const current = await this.current(manager, request);
          if (current.version !== expectedVersion)
            return reject("PROJECT_METADATA_VERSION_CONFLICT", 409);
          for (const id of ownerIds) await activeMember(manager, request.workspaceId, id);
          const at = new Date().toISOString();
          const { contentHash: _oldHash, ...previous } = current;
          void _oldHash;
          const revision = createProjectRegistryRevision({
            ...previous,
            revisionId: randomUUID(),
            version: current.version + 1,
            name,
            ownerIds,
            reason,
            createdBy: authority.human,
            createdAt: at,
          });
          await manager.query(
            `INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,last_verified_at,next_verification_at,reason,created_by,created_at,semantic_body,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              revision.revisionId,
              request.workspaceId,
              request.projectId,
              revision.version,
              revision.key,
              revision.name,
              JSON.stringify(revision.ownerIds),
              revision.criticalityKey,
              revision.dataClassificationKey,
              revision.verificationStatus,
              revision.lastVerifiedAt ?? null,
              revision.nextVerificationAt ?? null,
              revision.reason,
              revision.createdBy.principalId,
              revision.createdAt,
              revision,
              revision.contentHash,
            ],
          );
          await manager.query(
            "UPDATE projects SET name=$3,current_registry_version=$4,row_version=row_version+1 WHERE workspace_id=$1 AND id=$2",
            [request.workspaceId, request.projectId, name, revision.version],
          );
          const { contentHash: _onboardingHash, ...previousOnboarding } = onboarding;
          void _onboardingHash;
          const resultRef = ref(revision.revisionId, revision.version, revision.contentHash);
          await appendOnboarding(
            manager,
            createOnboardingRevision({
              ...previousOnboarding,
              revisionId: randomUUID(),
              version: onboarding.version + 1,
              projectRegistryRef: resultRef,
              ownerSetHash: digest(ownerIds),
              gateResultRefs: [],
              actor: authority.human,
              createdAt: at,
              reason,
              reasonCode: "PROJECT_METADATA_UPDATED",
              correlationId: randomUUID(),
            }),
          );
          await auditAndEvent(
            manager,
            request,
            authority,
            "PROJECT_METADATA_UPDATED",
            resultRef,
            reason,
          );
          return { status: "APPLIED", version: revision.version, resultRef };
        },
      );
    });
  }
}
