import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  type ArtifactAccessAuthorizer,
  type ArtifactReference,
  ArtifactService,
  ClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  validateAuthorizationBasis,
  type WorkspaceContext,
} from "../../../../packages/platform-core/src/index.ts";
import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  TypeOrmArtifactRepository,
  TypeOrmIntegrationConfigurationRepository,
  TypeOrmScopedAccessRepository,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import { validateJobEnvelope } from "../../../../packages/platform-testkit/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  workspaceA: "00000000-0000-4000-8000-000000000010",
  workspaceB: "00000000-0000-4000-8000-000000000011",
  projectAlpha: "00000000-0000-4000-8000-000000000020",
  projectBeta: "00000000-0000-4000-8000-000000000021",
  projectDelta: "00000000-0000-4000-8000-000000000022",
  membership: "00000000-0000-4000-8000-000000000030",
  entitlement: "00000000-0000-4000-8000-000000000031",
  role: "00000000-0000-4000-8000-000000000032",
  artifact: "00000000-0000-4000-8000-000000000040",
  report: "00000000-0000-4000-8000-000000000050",
} as const;

const at = new Date("2026-08-30T00:00:00.000Z");
const actor = {
  kind: "HUMAN",
  principalId: ids.actor,
  issuer: "https://issuer.test",
  subject: "requester",
} as const;
const projectContext = (workspaceId: string, projectId: string): WorkspaceContext => ({
  actor,
  scope: { kind: "PROJECT", workspaceId, projectId },
  correlationId: "00000000-0000-4000-8000-000000000060",
  causationId: "00000000-0000-4000-8000-000000000061",
});

describe("AT-010 scope isolation on real PostgreSQL", () => {
  let postgres: RunningPostgres;
  let dataSource: ReturnType<typeof createPlatformDataSource>;

  beforeAll(async () => {
    postgres = await startPostgres();
    dataSource = createPlatformDataSource({
      url: postgres.url,
      entities: [],
      migrations: migrationClasses(coreMigrationRegistry),
    });
    await new OneShotMigrationRunner(
      dataSource,
      "core",
      Math.max(...coreMigrationRegistry.map(({ order }) => order)),
    ).run();
    await dataSource.query(
      "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES($1,'https://issuer.test','requester','HUMAN','Requester')",
      [ids.actor],
    );
    await dataSource.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'workspace-a','A','ACTIVE'),($2,'workspace-b','B','ACTIVE')",
      [ids.workspaceA, ids.workspaceB],
    );
    await dataSource.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'alpha','Alpha','ACTIVE','INTERNAL'),($3,$2,'beta','Beta','ACTIVE','INTERNAL'),($4,$5,'delta','Delta','ACTIVE','INTERNAL')",
      [ids.projectAlpha, ids.workspaceA, ids.projectBeta, ids.projectDelta, ids.workspaceB],
    );
    await dataSource.query(
      "INSERT INTO workspace_memberships(id,workspace_id,principal_id,state,valid_from) VALUES($1,$2,$3,'ACTIVE','2026-01-01')",
      [ids.membership, ids.workspaceA, ids.actor],
    );
    await dataSource.query(
      "INSERT INTO project_entitlements(id,workspace_id,project_id,principal_id,effect,classification_ceiling_key,permissions,valid_from) VALUES($1,$2,$3,$4,'ALLOW','INTERNAL','[\"artifact.read\"]','2026-01-01')",
      [ids.entitlement, ids.workspaceA, ids.projectAlpha, ids.actor],
    );
    await dataSource.query(
      "INSERT INTO role_assignments(id,workspace_id,project_id,principal_id,role_key,effect,permissions,valid_from) VALUES($1,$2,$3,$4,'requester','ALLOW','[\"artifact.read\"]','2026-01-01')",
      [ids.role, ids.workspaceA, ids.projectAlpha, ids.actor],
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (postgres) await postgres.stop();
  });

  it("returns no repository/config rows for forged Workspace or Project identifiers", async () => {
    const access = new TypeOrmScopedAccessRepository(dataSource);
    await expect(
      access.getProject({
        kind: "PROJECT",
        workspaceId: ids.workspaceA,
        projectId: ids.projectDelta,
      }),
    ).resolves.toBeUndefined();

    const reports = new TypeOrmIntegrationConfigurationRepository(dataSource);
    await dataSource.query(
      "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,1,'VALID','sha256:test',$5,$6)",
      [
        ids.report,
        ids.workspaceA,
        ids.projectAlpha,
        ids.projectAlpha,
        JSON.stringify({ id: ids.report }),
        at,
      ],
    );
    await expect(
      reports.validationReport(
        { kind: "PROJECT", workspaceId: ids.workspaceA, projectId: ids.projectBeta },
        ids.report,
      ),
    ).resolves.toBeUndefined();
    await expect(
      reports.validationReport(
        { kind: "PROJECT", workspaceId: ids.workspaceB, projectId: ids.projectDelta },
        ids.report,
      ),
    ).resolves.toBeUndefined();
  });

  it("denies revoked grants before a protected repository is called", async () => {
    const access = new TypeOrmScopedAccessRepository(dataSource);
    await dataSource.query("UPDATE project_entitlements SET revoked_at='2026-08-29' WHERE id=$1", [
      ids.entitlement,
    ]);
    const facts = await access.authorizationFacts(
      projectContext(ids.workspaceA, ids.projectAlpha).scope,
      ids.actor,
      at,
    );
    const decision = new DenyByDefaultAuthorizationPolicy().decide({
      context: projectContext(ids.workspaceA, ids.projectAlpha),
      permission: "artifact.read",
      resourceClassification: { key: "INTERNAL", rank: 10 },
      facts,
      at,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "NO_ENTITLEMENT" as const });
  });

  it("rejects a Project basis without entitlement and a Workspace basis with a fabricated entitlement", () => {
    const common = {
      policyVersion: "identity-access@1",
      membershipRef: { id: ids.membership, version: 1 },
      roleAssignmentRefs: [{ id: ids.role, version: 1 }],
      skillContext: "NOT_APPLICABLE" as const,
    };
    expect(() =>
      validateAuthorizationBasis(projectContext(ids.workspaceA, ids.projectAlpha).scope, {
        ...common,
        kind: "PROJECT",
        entitlementRefs: [],
      }),
    ).toThrow(/Entitlement/u);
    expect(() =>
      validateAuthorizationBasis(
        { kind: "WORKSPACE", workspaceId: ids.workspaceA },
        { ...common, kind: "WORKSPACE", entitlementRefs: [{ id: ids.entitlement, version: 1 }] },
      ),
    ).toThrow(/fabricate/u);
  });

  it("preserves historical classification decisions after retirement and a new taxonomy key", () => {
    const catalog = new ClassificationCatalog([
      { key: "INTERNAL_V1", rank: 10 },
      { key: "RESTRICTED_V1", rank: 20 },
    ]);
    const historical = catalog.evaluate(
      { key: "RESTRICTED_V1", rank: 20 },
      { key: "INTERNAL_V1", rank: 10 },
    );
    const evolved = catalog.retire("INTERNAL_V1", at).extend({ key: "INTERNAL_V2", rank: 15 });
    expect(evolved.replay(historical)).toEqual(historical);
    expect(() => evolved.assignableReference("INTERNAL_V1", new Date("2026-08-31"))).toThrow(
      "CLASSIFICATION_RETIRED",
    );
    expect(evolved.reference("INTERNAL_V2")).toEqual({ key: "INTERNAL_V2", rank: 15 });
  });

  it("does not call object storage for cross-scope artifact content", async () => {
    const repository = new TypeOrmArtifactRepository(dataSource);
    const reference: ArtifactReference = {
      id: ids.artifact,
      workspaceId: ids.workspaceA,
      projectId: ids.projectAlpha,
      owner: { entityType: "WORK_ITEM", entityId: ids.projectAlpha },
      artifactKind: "GENERIC_FILE",
      storage: {
        providerKind: "LEGACY_EXTERNAL",
        opaqueLocator: "private/alpha/object",
        objectVersionOrEtag: "v1",
      },
      fileName: "result.txt",
      mediaType: "text/plain",
      sizeBytes: 6,
      checksum: { algorithm: "SHA256", value: "sha256:test" },
      classification: { key: "INTERNAL", rank: 10 },
      availability: "AVAILABLE",
      createdBy: ids.actor,
      createdAt: at,
    };
    await repository.save(
      { kind: "PROJECT", workspaceId: ids.workspaceA, projectId: ids.projectAlpha },
      reference,
    );
    const authorizer: ArtifactAccessAuthorizer = {
      authorizeScope: vi.fn(async (context: WorkspaceContext) => ({
        allowed: context.scope.kind === "PROJECT" && context.scope.projectId === ids.projectAlpha,
        reason: "NO_ENTITLEMENT" as const,
      })),
      authorizeResource: vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const })),
    };
    const storage = {
      stream: vi.fn(async () => ({
        body: (async function* () {
          yield new TextEncoder().encode("secret");
        })(),
      })),
    };
    const service = new ArtifactService(repository, storage, authorizer);
    await expect(
      service.streamArtifactContent(projectContext(ids.workspaceA, ids.projectBeta), ids.artifact),
    ).rejects.toThrow("ARTIFACT_ACCESS_DENIED");
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it.each(["workspaceId", "projectId", "actor", "correlationId", "causationId"] as const)(
    "rejects a forged worker %s before effect invocation",
    (field) => {
      const command = {
        id: "command",
        workspaceId: ids.workspaceA,
        projectId: ids.projectAlpha,
        actor: { principalId: ids.actor },
        correlationId: "correlation",
        causationId: "causation",
        rowVersion: 2,
        commandType: "sample.record.publish",
        effectIdempotencyKey: "effect",
        target: {},
        payload: {},
        bindingRef: {},
        profileRef: {},
        initialAuthorizationBasis: {},
      };
      const envelope = {
        schemaVersion: 1 as const,
        commandId: command.id,
        workspaceId: command.workspaceId,
        projectId: command.projectId,
        actor: command.actor,
        correlationId: command.correlationId,
        causationId: command.causationId,
        rowVersion: 1,
      };
      const forged =
        field === "actor"
          ? { ...envelope, actor: { principalId: "forged" } }
          : { ...envelope, [field]: "forged" };
      expect(() => validateJobEnvelope(forged, command)).toThrow("JOB_ENVELOPE_MISMATCH");
    },
  );
});
