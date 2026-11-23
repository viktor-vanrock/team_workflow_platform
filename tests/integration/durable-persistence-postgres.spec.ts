import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CommandGateway,
  decideApproval,
  EffectAuthorizationService,
} from "../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  TypeOrmApprovalRepository,
  TypeOrmAuditRepository,
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
  TypeOrmIdempotencyRepository,
  TypeOrmUnitOfWork,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  DeterministicClock,
  DeterministicIdGenerator,
  type RunningPostgres,
  startPostgres,
  workspaceContext,
} from "../../packages/platform-testkit/src/index.ts";

describe("T089-T106 PostgreSQL durable authority", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const actorId = "99999999-9999-4999-8999-999999999999";
  const approverId = "12121212-1212-4212-8212-121212121212";

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
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'https://issuer.test','requester','HUMAN','Requester'),($2,'https://issuer.test','approver','HUMAN','Approver')",
      [actorId, approverId],
    );
    await source.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'durable','Durable','ACTIVE')",
      [workspaceId],
    );
    await source.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'project','Project','ACTIVE','INTERNAL')",
      [projectId, workspaceId],
    );
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  it("runs Gateway through the PostgreSQL UoW and enforces exact Approval CAS", async () => {
    const clock = new DeterministicClock();
    const unitOfWork = new TypeOrmUnitOfWork(source);
    const gateway = new CommandGateway(
      unitOfWork,
      clock,
      new DeterministicIdGenerator("77777777-7777-4777-8777"),
    );
    const context = workspaceContext({
      actor: {
        kind: "HUMAN",
        principalId: actorId,
        issuer: "https://issuer.test",
        subject: "requester",
      },
      scope: { kind: "PROJECT", workspaceId, projectId },
      authorizationBasis: {
        kind: "PROJECT",
        policyVersion: "policy@1",
        membershipRef: {
          id: "abababab-abab-4bab-8bab-abababababab",
          version: 1,
        },
        roleAssignmentRefs: [],
        entitlementRefs: [],
        skillContext: "NOT_APPLICABLE",
      },
    });
    const baseIntent = {
      commandType: "sample.record.publish",
      capability: {
        key: "sample.record",
        exactContractVersion: "1.0.0",
        operation: "record.publish",
        logicalRole: "ROUND_TRIP_ROLE",
      },
      target: { id: "phase1-db" },
      payload: { message: "hello" },
      expectedExternalState: { mode: "MUST_NOT_EXIST" },
      bindingRef: {
        id: "44444444-4444-4444-8444-444444444444",
        version: 1,
      },
      profileRef: {
        id: "55555555-5555-4555-8555-555555555555",
        version: 1,
      },
      dataClassificationKey: "INTERNAL",
      source: {
        sourceWorkItemId: "34343434-3434-4434-8434-343434343434",
      },
    } as const;

    const submitted = await gateway.submit(context, {
      ...baseIntent,
      clientRequestKey: "db-request",
    });
    const replayed = await gateway.submit(context, {
      ...baseIntent,
      clientRequestKey: "db-request",
    });
    expect(replayed).toMatchObject({
      replayed: true,
      command: { id: submitted.command.id },
    });

    expect(
      await new TypeOrmCommandRepository(source).get(workspaceId, projectId, submitted.command.id),
    ).toMatchObject({
      effectIdempotencyKey: submitted.command.effectIdempotencyKey,
      capability: { logicalRole: "ROUND_TRIP_ROLE" },
    });
    expect(
      (
        await new TypeOrmIdempotencyRepository(source).find({
          workspaceId,
          projectId,
          actorId,
          operation: submitted.command.commandType,
          clientKey: submitted.command.clientRequestKey,
        })
      )?.commandId,
    ).toBe(submitted.command.id);
    expect(
      await new TypeOrmCommandOutboxRepository(source).claim(
        clock.now(),
        new Date(clock.now().getTime() + 60_000),
      ),
    ).toHaveLength(1);
    expect(
      await new TypeOrmAuditRepository(source).query(
        { kind: "PROJECT", workspaceId, projectId },
        { correlationId: submitted.command.correlationId },
      ),
    ).toHaveLength(1);

    const held = await gateway.submit(context, {
      ...baseIntent,
      clientRequestKey: "db-approval",
      approvalRequired: true,
    });
    expect(held.command).toMatchObject({
      status: "AWAITING_APPROVAL",
      effectAuthorizationStatus: "PENDING",
      outboxStatus: "HELD",
    });

    const approvals = new TypeOrmApprovalRepository(source);
    const pending = await approvals.get(workspaceId, projectId, held.command.approvalId!);
    expect(pending).toMatchObject({
      action: {
        actionKind: "EXTERNAL_COMMAND",
        actionId: held.command.id,
        capabilityKey: "sample.record",
        capabilityVersion: "1.0.0",
        operation: "record.publish",
      },
      target: baseIntent.target,
      targetHash: held.command.targetHash,
      payloadHash: held.command.payloadHash,
      expectedState: baseIntent.expectedExternalState,
      bindingRef: baseIntent.bindingRef,
      profileRefs: [baseIntent.profileRef],
      effectIdempotencyKey: held.command.effectIdempotencyKey,
    });

    const approved = decideApproval(pending!, {
      approverId,
      approverRole: "WORKSPACE_OWNER",
      authorizationBasisHash: "sha256:basis",
    });
    await approvals.save(approved, 1);
    await expect(approvals.save(approved, 1)).rejects.toThrow("APPROVAL_CAS_CONFLICT");
    const authorization = new EffectAuthorizationService(
      approvals.effectAuthorization(workspaceId, projectId),
    );
    const claims = await Promise.allSettled([
      authorization.consume(approved.id, {
        subjectHash: approved.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01T00:02:00.000Z"),
      }),
      authorization.consume(approved.id, {
        subjectHash: approved.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01T00:02:00.000Z"),
      }),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(await approvals.get(workspaceId, projectId, approved.id)).toMatchObject({
      decisionStatus: "APPROVED",
      effectAuthorizationStatus: "CONSUMED",
    });
    await expect(source.query("UPDATE audit_events SET reason_code='TAMPERED'")).rejects.toThrow();
  });
});
