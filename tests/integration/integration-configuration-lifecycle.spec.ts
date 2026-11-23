import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../packages/platform-contracts/src/index.ts";
import { defaultClassificationCatalog } from "../../packages/platform-core/src/index.ts";
import { ConnectionMappingLifecycle } from "../../packages/platform-core/src/integration-registry/connection-mapping-lifecycle.ts";
import { InMemoryIntegrationConfigurationRepository } from "../../packages/platform-core/src/integration-registry/model.ts";
import {
  DeterministicClock,
  DeterministicIdGenerator,
  workspaceContext,
} from "../../packages/platform-testkit/src/index.ts";

const workspace = workspaceContext({
  scope: { kind: "WORKSPACE", workspaceId: "00000000-0000-4000-8000-000000000010" },
  authorizationBasis: {
    kind: "WORKSPACE",
    policyVersion: "identity-access@1",
    membershipRef: { id: "membership", version: 1 },
    roleAssignmentRefs: [{ id: "role", version: 1 }],
    entitlementRefs: [],
    skillContext: "NOT_APPLICABLE",
  },
});

describe("T057 integration configuration lifecycle", () => {
  it("pins semantic hashes, enforces ETag transitions and isolates mutable health", async () => {
    const repository = new InMemoryIntegrationConfigurationRepository();
    const service = new ConnectionMappingLifecycle(
      repository,
      designContractRegistry,
      defaultClassificationCatalog,
      new DeterministicClock(),
      new DeterministicIdGenerator(),
    );
    const draft = await service.createConnection(workspace, {
      key: "sample-local",
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      environmentClass: "LOCAL",
      endpoint: "http://mock-hub:4010",
      serviceIdentitySecretRef: "secretref://local/mock-hub",
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
    expect(draft).toMatchObject({ state: "DRAFT", version: 1, resourceVersion: 1 });
    expect(draft.contentHash).toMatch(/^sha256:/u);

    const validation = await service.validateConnection(workspace, draft.id, 1, 1);
    expect(validation.report.status).toBe("VALID");
    expect(validation.revision.validationReportId).toBe(validation.report.id);
    const published = await service.publishConnection(
      workspace,
      draft.id,
      1,
      validation.revision.resourceVersion,
    );
    expect(published.state).toBe("PUBLISHED");
    await expect(service.publishConnection(workspace, draft.id, 1, 1)).rejects.toThrow(
      "ETAG_MISMATCH",
    );

    const health = await service.updateConnectionHealth(
      workspace,
      { id: draft.id, version: 1 },
      "DEGRADED",
      "TIMEOUT",
    );
    expect(health.healthState).toBe("DEGRADED");
    expect(
      (await repository.connection(workspace.scope.workspaceId, draft.id, 1))?.contentHash,
    ).toBe(published.contentHash);
  });
});
