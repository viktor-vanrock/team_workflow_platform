import type { EntityManager } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import {
  type BindingRevision,
  configurationFacts,
} from "../../apps/api/src/extensions/onboarding/binding-facts.ts";
import { integrationConfigurationHash } from "../../packages/runtime-composition/src/onboarding/configuration-hash.ts";

const scope = { workspaceId: "workspace", projectId: "project" };
const connection = { connectorKey: "jira.operational-authority" };
const mapping = { connectorKey: "jira.operational-authority" };
const profile = {
  connectorKey: "jira.operational-authority",
  connectionRef: { id: "connection", version: 1 },
  mappingRef: { id: "mapping", version: 1 },
  capabilityConfigurations: [
    {
      capabilityKey: "operational-work-item",
      exactContractVersion: "1.0.0",
      environmentScopes: ["LOCAL"],
    },
  ],
};
const documents = {
  connector_profile: profile,
  connection,
  connector_mapping: mapping,
} as const;
const binding: BindingRevision = {
  id: "revision",
  version: 1,
  status: "DRAFT",
  content_hash: `sha256:${"0".repeat(64)}`,
  content: {
    ...scope,
    entries: [
      {
        logicalRole: "QA_REQUEST_AUTHORITY",
        profileRef: { id: "profile", version: 1 },
        capabilityKey: "operational-work-item",
        exactContractVersion: "1.0.0",
        environmentScope: "LOCAL",
      },
    ],
  },
};

function manager(options: { missing?: string; corrupt?: string } = {}): EntityManager {
  return {
    query: vi.fn(async (sql: string, parameters: unknown[]) => {
      const kind = (Object.keys(documents) as (keyof typeof documents)[]).find((value) =>
        sql.includes(`FROM ${value}_headers`),
      );
      if (!kind || options.missing === kind || parameters[2] !== 1) return [];
      const content = documents[kind];
      return [
        {
          content,
          content_hash:
            options.corrupt === kind
              ? `sha256:${"0".repeat(64)}`
              : integrationConfigurationHash(kind, content),
        },
      ];
    }),
  } as unknown as EntityManager;
}

describe("onboarding resolves exact Jira configuration references", () => {
  it("resolves current id/version and returns independently computed hashes", async () => {
    const refs = await configurationFacts(manager(), scope, binding);
    expect(refs).toEqual(
      expect.arrayContaining([
        {
          id: "profile",
          version: 1,
          contentHash: integrationConfigurationHash("connector_profile", profile),
        },
        {
          id: "connection",
          version: 1,
          contentHash: integrationConfigurationHash("connection", connection),
        },
        {
          id: "mapping",
          version: 1,
          contentHash: integrationConfigurationHash("connector_mapping", mapping),
        },
      ]),
    );
  });

  it("rejects a missing version and a mismatched stored hash", async () => {
    await expect(
      configurationFacts(manager({ missing: "connection" }), scope, binding),
    ).rejects.toThrow();
    await expect(
      configurationFacts(manager({ corrupt: "connector_profile" }), scope, binding),
    ).rejects.toThrow();
    const stale = structuredClone(binding);
    (stale.content.entries as { profileRef: { version: number } }[])[0]!.profileRef.version = 2;
    await expect(configurationFacts(manager(), scope, stale)).rejects.toThrow();
  });
});
