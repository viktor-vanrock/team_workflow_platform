import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertBindingPublicationDecision,
  type BindingPublicationApprover,
  decideApproval,
  recomputeExactApprovalSubjectHash,
} from "../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  TypeOrmApprovalRepository,
  TypeOrmBindingPublicationExecutor,
  TypeOrmBindingPublicationRequestRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { type RunningPostgres, startPostgres } from "../../packages/platform-testkit/src/index.ts";

describe("T107-T108 PostgreSQL Binding publication authority", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
  const workspaceId = "21111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222223";
  const adminId = "29999999-9999-4999-8999-999999999999";
  const ownerId = "21212121-1212-4212-8212-121212121212";
  const bindingId = "24444444-4444-4444-8444-444444444444";

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: coreEntities,
      migrations: migrationClasses(coreMigrationRegistry),
    });
    await new OneShotMigrationRunner(
      source,
      "core",
      Math.max(...coreMigrationRegistry.map(({ order }) => order)),
    ).run();
    await source.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'https://issuer.test','admin','HUMAN','Admin'),($2,'https://issuer.test','owner','HUMAN','Owner')",
      [adminId, ownerId],
    );
    await source.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'binding','Binding','ACTIVE')",
      [workspaceId],
    );
    await source.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'project','Project','ACTIVE','INTERNAL')",
      [projectId, workspaceId],
    );
    await source.query(
      "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version,row_version) VALUES($1,$2,$3,'primary',NULL,2)",
      [bindingId, workspaceId, projectId],
    );
    await insertCandidate(1, "sha256:candidate-1");
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  async function insertCandidate(version: number, contentHash: string) {
    const revisionId =
      version === 1
        ? "25555555-5555-4555-8555-555555555551"
        : "25555555-5555-4555-8555-555555555552";
    const reportId =
      version === 1
        ? "26666666-6666-4666-8666-666666666661"
        : "26666666-6666-4666-8666-666666666662";
    await source.query(
      "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,'VALIDATED','{}',$6,'2026-01-01')",
      [revisionId, workspaceId, projectId, bindingId, version, contentHash],
    );
    await source.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,$5,'VALID',$6,'{}','2026-01-01')",
      [reportId, workspaceId, projectId, bindingId, version, contentHash],
    );
  }

  const approver: BindingPublicationApprover = {
    approverId: ownerId,
    approverRole: "WORKSPACE_OWNER",
    permissions: ["project.admin"],
  };

  it("atomically consumes exact Approval and publishes once; drift rolls back", async () => {
    const requests = new TypeOrmBindingPublicationRequestRepository(source);
    const approvals = new TypeOrmApprovalRepository(source);
    const executor = new TypeOrmBindingPublicationExecutor(source);
    const requested = await requests.request({
      workspaceId,
      projectId,
      actionId: "27777777-7777-4777-8777-777777777771",
      approvalId: "28888888-8888-4888-8888-888888888881",
      initiator: {
        kind: "HUMAN",
        principalId: adminId,
        issuer: "https://issuer.test",
        subject: "admin",
      },
      initiatorRole: "INTEGRATION_ADMINISTRATOR",
      bindingRef: { id: bindingId, version: 1 },
      expectedResourceVersion: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(recomputeExactApprovalSubjectHash(requested.approval)).toBe(
      requested.approval.subjectHash,
    );
    assertBindingPublicationDecision(requested.action.initiatorId, approver);
    await approvals.save(
      decideApproval(requested.approval, {
        approverId: approver.approverId,
        approverRole: approver.approverRole,
        authorizationBasisHash: "sha256:owner-basis",
      }),
      1,
    );

    const published = await executor.publish({
      workspaceId,
      projectId,
      actionId: requested.action.id,
      approvalId: requested.approval.id,
      approver,
      now: new Date("2026-01-01T00:02:00.000Z"),
    });
    expect(published).toMatchObject({
      bindingId,
      version: 1,
      state: "PUBLISHED",
      currentPublishedVersion: 1,
    });
    expect(
      await executor.publish({
        workspaceId,
        projectId,
        actionId: requested.action.id,
        approvalId: requested.approval.id,
        approver,
        now: new Date("2026-01-01T00:03:00.000Z"),
      }),
    ).toEqual(published);
    expect(await approvals.get(workspaceId, projectId, requested.approval.id)).toMatchObject({
      effectAuthorizationStatus: "CONSUMED",
    });

    await insertCandidate(2, "sha256:candidate-2");
    const drifted = await requests.request({
      workspaceId,
      projectId,
      actionId: "27777777-7777-4777-8777-777777777772",
      approvalId: "28888888-8888-4888-8888-888888888882",
      initiator: {
        kind: "HUMAN",
        principalId: adminId,
        issuer: "https://issuer.test",
        subject: "admin",
      },
      initiatorRole: "INTEGRATION_ADMINISTRATOR",
      bindingRef: { id: bindingId, version: 2 },
      expectedResourceVersion: 3,
      createdAt: new Date("2026-01-01T00:04:00.000Z"),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    await approvals.save(
      decideApproval(drifted.approval, {
        approverId: approver.approverId,
        approverRole: approver.approverRole,
        authorizationBasisHash: "sha256:owner-basis",
      }),
      1,
    );
    await source.query(
      "UPDATE project_integration_binding_revisions SET content_hash='sha256:tampered' WHERE workspace_id=$1 AND project_id=$2 AND header_id=$3 AND version=2",
      [workspaceId, projectId, bindingId],
    );
    await expect(
      executor.publish({
        workspaceId,
        projectId,
        actionId: drifted.action.id,
        approvalId: drifted.approval.id,
        approver,
        now: new Date("2026-01-01T00:05:00.000Z"),
      }),
    ).rejects.toThrow("CANDIDATE_DRIFT");
    expect(
      await source.query("SELECT state FROM platform_actions WHERE id=$1", [drifted.action.id]),
    ).toEqual([{ state: "PENDING_APPROVAL" }]);
    expect(await approvals.get(workspaceId, projectId, drifted.approval.id)).toMatchObject({
      effectAuthorizationStatus: "AUTHORIZED",
    });
  });
});
