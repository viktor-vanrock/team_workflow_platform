import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { digest } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import { createLocalQueueHttpAuthority } from "../../../apps/api/src/local/local-queue-http-authority.ts";
import { PostgresAuthorizedQueueProjects } from "../../../packages/runtime-composition/src/queue/portfolio-query.ts";
import {
  RuntimePortfolioQueueApi,
  RuntimeQueueApi,
} from "../../../packages/runtime-composition/src/queue/query-api.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startEvidenceHttpFixture } from "../../support/007-evidence-http-fixture.ts";
import { prepareScopeResources } from "../../support/007-scope-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 local authority uses current persisted facts",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "rejects DENY, expired membership and reduced classification on %s",
      async (image) => {
        const f = await startEvidenceHttpFixture(image),
          principalId = localPersonaIds["owner.local"],
          scope = f.scope;
        const authorize = () =>
          authorizeLocalQaApi(
            f.source,
            { headers: {}, localPersonaKey: "owner.local" },
            scope.workspaceId,
            scope.projectId,
            "artifact.read",
          );
        try {
          await expect(authorize()).resolves.toMatchObject({ classificationCeiling: "RESTRICTED" });
          await f.source.query(
            "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,permissions,classification_ceiling_key,valid_from) VALUES($1,$2,$3,$4,'DENY',$5,'RESTRICTED',now())",
            [
              randomUUID(),
              scope.workspaceId,
              scope.projectId,
              principalId,
              JSON.stringify(["artifact.read", "queue.project.read"]),
            ],
          );
          await expect(authorize()).rejects.toThrow("QA_SCOPE_DENIED");
          expect(
            (
              await new PostgresAuthorizedQueueProjects(f.source).resolveIdentity({
                workspaceId: scope.workspaceId,
                principalId,
              })
            ).projectIds,
          ).not.toContain(scope.projectId);
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=now(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='DENY'",
            [scope.workspaceId, scope.projectId, principalId],
          );
          const roleDeny = randomUUID();
          await f.source.query(
            "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'security-deny','DENY',$5,now())",
            [
              roleDeny,
              scope.workspaceId,
              scope.projectId,
              principalId,
              JSON.stringify(["artifact.read"]),
            ],
          );
          await expect(authorize()).rejects.toThrow("QA_SCOPE_DENIED");
          await f.source.query(
            "UPDATE role_assignments SET revoked_at=now(),row_version=row_version+1 WHERE id=$1",
            [roleDeny],
          );
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='INTERNAL',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [scope.workspaceId, scope.projectId, principalId],
          );
          await expect(authorize()).resolves.toMatchObject({ classificationCeiling: "INTERNAL" });
          await f.source.query(
            "UPDATE projects SET classification_key='RESTRICTED' WHERE workspace_id=$1 AND id=$2",
            [scope.workspaceId, scope.projectId],
          );
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='RESTRICTED' WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [scope.workspaceId, scope.projectId, localPersonaIds["lead.alpha"]],
          );
          const localQueue = createLocalQueueHttpAuthority(f.source);
          expect(
            (
              await localQueue.portfolio(
                { headers: {}, localPersonaKey: "lead.alpha" },
                scope.workspaceId,
                ["queue.portfolio.read", "queue.capacity.read"],
              )
            ).projectIds,
          ).not.toContain(scope.projectId);
          await f.source.query(
            "UPDATE projects SET classification_key='INTERNAL' WHERE workspace_id=$1 AND id=$2",
            [scope.workspaceId, scope.projectId],
          );
          await expect(authorize()).resolves.toMatchObject({ classificationCeiling: "INTERNAL" });
          await f.source.query(
            "UPDATE workspace_memberships SET valid_until=now()-interval '1 second' WHERE workspace_id=$1 AND principal_id=$2",
            [scope.workspaceId, principalId],
          );
          await expect(authorize()).rejects.toThrow("QA_SCOPE_DENIED");
          await f.source.query(
            "UPDATE workspace_memberships SET valid_until=NULL WHERE workspace_id=$1 AND principal_id=$2",
            [scope.workspaceId, principalId],
          );
          await expect(authorize()).resolves.toMatchObject({ classificationCeiling: "INTERNAL" });
          await f.source.query(
            "UPDATE project_entitlements SET valid_until=now()-interval '1 second',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [scope.workspaceId, scope.projectId, principalId],
          );
          await expect(authorize()).rejects.toThrow("QA_SCOPE_DENIED");
        } finally {
          await f.close();
        }
      },
      120_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "applies a stricter session ceiling before queue item/count/cursor reads on %s",
      async (image) => {
        const f = await startEvidenceHttpFixture(image),
          scope = f.scope,
          request = { headers: {}, localPersonaKey: "lead.alpha" },
          response = { setHeader: () => undefined };
        try {
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='RESTRICTED' WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [scope.workspaceId, scope.projectId, localPersonaIds["lead.alpha"]],
          );
          const generationId = randomUUID();
          await f.source.query(
            "INSERT INTO queue_projection_generations(generation_id,workspace_id,state,source_high_watermarks,input_set_hash,started_at,activated_at) VALUES($1,$2,'ACTIVE','{}',$3,now(),now())",
            [generationId, scope.workspaceId, digest("session-ceiling")],
          );
          const internal = await prepareScopeResources(
            f.source,
            f.directory,
            scope,
            "INTERNAL",
            generationId,
          );
          const restricted = await prepareScopeResources(
            f.source,
            f.directory,
            scope,
            "RESTRICTED",
            generationId,
          );
          const authority = createLocalQueueHttpAuthority(f.source),
            queue = new RuntimeQueueApi(f.source, authority),
            portfolio = new RuntimePortfolioQueueApi(f.source, authority);
          await expect(
            authority.project(request, scope.workspaceId, scope.projectId, "queue.project.read"),
          ).resolves.toMatchObject({ classificationCeiling: "INTERNAL" });
          await expect(
            queue.item(request, scope.workspaceId, scope.projectId, internal.workItemId, response),
          ).resolves.toMatchObject({ queueEntryId: internal.queueEntryId });
          await expect(
            queue.item(
              request,
              scope.workspaceId,
              scope.projectId,
              restricted.workItemId,
              response,
            ),
          ).rejects.toThrow("QUEUE_ITEM_NOT_FOUND");
          for (const page of [
            await queue.lane(
              request,
              scope.workspaceId,
              scope.projectId,
              undefined,
              undefined,
              undefined,
              "1",
              undefined,
              response,
            ),
            await portfolio.portfolio(
              request,
              scope.workspaceId,
              undefined,
              undefined,
              undefined,
              "1",
              undefined,
              response,
            ),
          ]) {
            expect(page.visibleCounts).toMatchObject({ total: 1 });
            expect(page.nextCursor).toBeNull();
            expect(JSON.stringify(page)).not.toContain(restricted.queueEntryId);
          }
        } finally {
          await f.close();
        }
      },
      120_000,
    );
  },
);
