import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  currentAuthority,
  digest,
  ref,
} from "../../apps/api/src/extensions/onboarding/durable-http.ts";
import {
  type BindingContent,
  type ConnectionContent,
  type ProfileContent,
  semanticContentHash,
} from "../../packages/platform-core/src/index.ts";
import { TypeOrmIntegrationConfigurationRepository } from "../../packages/platform-persistence-typeorm/src/index.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";

/** Provider Connection/Profile metadata are controlled prerequisites; Binding starts DRAFT. */
export async function prepareJourneyBinding(
  source: DataSource,
  scope: { workspaceId: string; projectId: string },
  providerUrl: string,
) {
  const f = { source, scope };
  const coreDraft = async () => {
    const repository = new TypeOrmIntegrationConfigurationRepository(f.source);
    const authority = await f.source.transaction((manager) =>
      currentAuthority(
        manager,
        { kind: "PROJECT", ...f.scope },
        localPersonaIds["integration-admin.alpha"],
        "integration.validate",
        "integration-administrator",
      ),
    );
    const metadata = {
      workspaceId: f.scope.workspaceId,
      version: 1,
      resourceVersion: 1,
      state: "PUBLISHED" as const,
      createdAt: new Date(),
      createdBy: authority.actor.principalId,
      authorizationBasis: authority.basis,
    };
    const connectionId = randomUUID(),
      profileId = randomUUID(),
      bindingId = randomUUID();
    const connectorRef = { key: "connector-jira", version: "1.0.0" };
    const connection: ConnectionContent = {
      key: connectionId,
      connectorRef,
      environmentClass: "LOCAL",
      endpoint: providerUrl,
      serviceIdentitySecretRef: "secretref://controlled/jira",
      quarantineClassificationKey: "INTERNAL",
      dataClassificationKey: "INTERNAL",
    };
    await repository.insertConnection({
      ...connection,
      ...metadata,
      id: connectionId,
      revisionId: randomUUID(),
      contentHash: semanticContentHash(connection as never),
    });
    await f.source.query("UPDATE connection_headers SET current_published_version=1 WHERE id=$1", [
      connectionId,
    ]);
    const externalScope = {
      schemaRef: {
        id: "urn:controlled:project-scope",
        version: 1,
        digest: digest({ type: "object" }),
      },
      value: { projectKey: "ALPHA" },
    };
    const profile: ProfileContent = {
      key: profileId,
      connectorRef,
      connectionRef: { id: connectionId, version: 1 },
      dataClassificationKey: "INTERNAL",
      capabilityConfigurations: [
        {
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          environmentScopes: ["LOCAL"],
          allowedDataClassifications: ["INTERNAL"],
          externalScope,
          operations: ["request.create", "request.transition", "request.read", "defect.create"].map(
            (operation) => ({
              operation,
              effect: operation.endsWith(".read") ? "READ" : "WRITE",
              idempotencyStrategy: "NATURAL_KEY_LOOKUP",
              confirmationMode: "READ_BACK",
            }),
          ),
        },
      ],
    };
    await repository.insertProfile({
      ...profile,
      ...metadata,
      id: profileId,
      revisionId: randomUUID(),
      contentHash: semanticContentHash(profile as never),
    });
    await f.source.query(
      "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
      [profileId],
    );
    const content: BindingContent = {
      key: bindingId,
      dataClassificationKey: "INTERNAL",
      entries: ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"].map(
        (logicalRole) => ({
          logicalRole,
          capabilityKey: "operational-work-item",
          exactContractVersion: "1.0.0",
          environmentScope: "LOCAL",
          classificationCeilingKey: "INTERNAL",
          profileRef: { id: profileId, version: 1 },
          externalScope,
        }),
      ),
      configurationRefs: [],
      resourceRefs: [],
    };
    const hash = semanticContentHash(content as never);
    await repository.insertBinding({
      ...content,
      ...metadata,
      projectId: f.scope.projectId,
      id: bindingId,
      revisionId: randomUUID(),
      state: "DRAFT",
      contentHash: hash,
    });
    return ref(bindingId, 1, hash);
  };
  return coreDraft();
}
