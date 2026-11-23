import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { designContractRegistry } from "../../packages/platform-contracts/src/index.ts";
import {
  ConnectionMappingLifecycle,
  defaultClassificationCatalog,
} from "../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  TypeOrmIntegrationConfigurationRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  DeterministicClock,
  DeterministicIdGenerator,
  type RunningPostgres,
  startPostgres,
  workspaceContext,
} from "../../packages/platform-testkit/src/index.ts";

describe("T065 PostgreSQL integration configuration repository", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;
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
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'config-test','Configuration Test','ACTIVE')",
      ["00000000-0000-4000-8000-000000000010"],
    );
  }, 120_000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });
  it("locks the header, pins a valid report and keeps health outside semantic content", async () => {
    const repository = new TypeOrmIntegrationConfigurationRepository(source);
    const service = new ConnectionMappingLifecycle(
      repository,
      designContractRegistry,
      defaultClassificationCatalog,
      new DeterministicClock(),
      new DeterministicIdGenerator("10000000-0000-4000-8000"),
    );
    const context = workspaceContext({
      scope: { kind: "WORKSPACE", workspaceId: "00000000-0000-4000-8000-000000000010" },
      authorizationBasis: {
        kind: "WORKSPACE",
        policyVersion: "policy@1",
        membershipRef: { id: "00000000-0000-4000-8000-000000000011", version: 1 },
        roleAssignmentRefs: [],
        entitlementRefs: [],
        skillContext: "NOT_APPLICABLE",
      },
    });
    const draft = await service.createConnection(context, {
      key: "mock",
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      environmentClass: "LOCAL",
      endpoint: "http://mock-hub:4010",
      serviceIdentitySecretRef: "secretref://local/mock",
      quarantineClassificationKey: "RESTRICTED",
      dataClassificationKey: "INTERNAL",
      connectorConfiguration: {
        schemaRef: {
          id: "urn:awp:schemas:sample:connection-config:v1",
          version: 1,
          digest: designContractRegistry.digest("urn:awp:schemas:sample:connection-config:v1"),
        },
        value: { transport: "HTTP", requestTimeoutMs: 5000 },
      },
    });
    const validated = await service.validateConnection(context, draft.id, 1, 1);
    const published = await service.publishConnection(
      context,
      draft.id,
      1,
      validated.revision.resourceVersion,
    );
    await service.updateConnectionHealth(
      context,
      { id: draft.id, version: 1 },
      "DEGRADED",
      "TIMEOUT",
    );
    expect((await repository.connection(context.scope.workspaceId, draft.id, 1))?.state).toBe(
      "PUBLISHED",
    );
    expect(
      (await repository.connectionHealth(context.scope.workspaceId, draft.id))?.reasonCode,
    ).toBe("TIMEOUT");
    expect(published.contentHash).toBe(draft.contentHash);
  });
});
