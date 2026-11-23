import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  CapabilityRegistry,
  defaultClassificationCatalog,
} from "../../../packages/platform-core/src/index.ts";
import { BindingLifecycle } from "../../../packages/platform-core/src/integration-registry/binding-lifecycle.ts";
import { ConnectionMappingLifecycle } from "../../../packages/platform-core/src/integration-registry/connection-mapping-lifecycle.ts";
import { InMemoryIntegrationConfigurationRepository } from "../../../packages/platform-core/src/integration-registry/model.ts";
import { ProfileLifecycle } from "../../../packages/platform-core/src/integration-registry/profile-lifecycle.ts";
import {
  DeterministicClock,
  DeterministicIdGenerator,
  workspaceContext,
} from "../../../packages/platform-testkit/src/index.ts";

describe("AT-014 immutable configuration chain", () => {
  it("rejects cross-Workspace pins, weak quarantine and failed validation without mutating the candidate", async () => {
    const repository = new InMemoryIntegrationConfigurationRepository();
    const capabilities = CapabilityRegistry.sampleRecord();
    const clock = new DeterministicClock();
    const ids = new DeterministicIdGenerator();
    const connections = new ConnectionMappingLifecycle(
      repository,
      designContractRegistry,
      defaultClassificationCatalog,
      clock,
      ids,
    );
    const profiles = new ProfileLifecycle(
      repository,
      capabilities,
      defaultClassificationCatalog,
      clock,
      ids,
    );
    const bindings = new BindingLifecycle(
      repository,
      capabilities,
      defaultClassificationCatalog,
      clock,
      ids,
    );
    const ws = workspaceContext({
      scope: { kind: "WORKSPACE", workspaceId: "workspace-a" },
      authorizationBasis: {
        kind: "WORKSPACE",
        policyVersion: "identity-access@1",
        membershipRef: { id: "m", version: 1 },
        roleAssignmentRefs: [{ id: "r", version: 1 }],
        entitlementRefs: [],
        skillContext: "NOT_APPLICABLE",
      },
    });
    const project = workspaceContext({
      scope: { kind: "PROJECT", workspaceId: "workspace-a", projectId: "project-a" },
      authorizationBasis: {
        kind: "PROJECT",
        policyVersion: "identity-access@1",
        membershipRef: { id: "m", version: 1 },
        roleAssignmentRefs: [{ id: "r", version: 1 }],
        entitlementRefs: [{ id: "e", version: 1 }],
        skillContext: "NOT_APPLICABLE",
      },
    });

    const connection = await connections.createConnection(ws, {
      key: "weak",
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      environmentClass: "LOCAL",
      endpoint: "http://mock-hub:4010",
      serviceIdentitySecretRef: "secretref://local/mock",
      quarantineClassificationKey: "INTERNAL",
      dataClassificationKey: "INTERNAL",
    });
    const validatedConnection = await connections.validateConnection(ws, connection.id, 1, 1);
    const publishedConnection = await connections.publishConnection(
      ws,
      connection.id,
      1,
      validatedConnection.revision.resourceVersion,
    );
    const profile = await profiles.createProfile(ws, {
      key: "profile",
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      connectionRef: { id: publishedConnection.id, version: 1 },
      dataClassificationKey: "INTERNAL",
      capabilityConfigurations: [
        {
          capabilityKey: "sample.record",
          exactContractVersion: "1.0.0",
          operations: [
            {
              operation: "record.publish",
              effect: "WRITE",
              idempotencyStrategy: "NATIVE_KEY",
              confirmationMode: "SYNC_RECEIPT",
            },
          ],
          environmentScopes: ["LOCAL"],
          allowedDataClassifications: ["RESTRICTED"],
          externalScope: {
            schemaRef: {
              id: "urn:awp:schemas:sample:record-external-scope:v1",
              version: 1,
              digest: designContractRegistry.digest(
                "urn:awp:schemas:sample:record-external-scope:v1",
              ),
            },
            value: { namespace: "phase1", allowedRecordPrefix: "phase1-" },
          },
        },
      ],
    });
    const invalid = await profiles.validateProfile(ws, profile.id, 1, 1);
    expect(invalid.report.status).toBe("INVALID");
    expect((await repository.profile(ws.scope.workspaceId, profile.id, 1))?.state).toBe("DRAFT");

    await expect(
      bindings.createBinding(project, {
        dataClassificationKey: "INTERNAL",
        entries: [
          {
            logicalRole: "PRIMARY",
            capabilityKey: "sample.record",
            exactContractVersion: "1.0.0",
            environmentScope: "LOCAL",
            classificationCeilingKey: "RESTRICTED",
            profileRef: { id: "foreign-profile", version: 1 },
            externalScope: {
              schemaRef: {
                id: "urn:awp:schemas:sample:record-external-scope:v1",
                version: 1,
                digest: designContractRegistry.digest(
                  "urn:awp:schemas:sample:record-external-scope:v1",
                ),
              },
              value: { namespace: "phase1", allowedRecordPrefix: "phase1-" },
            },
          },
        ],
      }),
    ).rejects.toThrow("PROFILE_SCOPE_MISMATCH");
  });
});
