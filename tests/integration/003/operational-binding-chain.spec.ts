import { describe, expect, it } from "vitest";

import {
  ConfigurationPinSet,
  OperationalAuthorityBindingAggregate,
} from "../../../packages/platform-core/src/index.ts";

const primary = {
  sequence: 0,
  purpose: "PRIMARY" as const,
  logicalRole: "QA_REQUEST_AUTHORITY",
  authorityNamespaceHash: "sha256:a",
  bindingRef: { id: "b", version: 1 },
  profileRef: { id: "p", version: 1 },
  mappingRef: { id: "m", version: 1 },
  connectionRef: { id: "c", version: 1 },
  contentHash: "sha256:1" as const,
  adapterFamily: "jira-cloud-v3",
  adapterContractVersion: "1.0.0",
};
const auxiliary = {
  ...primary,
  sequence: 1,
  purpose: "AUXILIARY" as const,
  logicalRole: "SOURCE_CONTEXT",
  bindingRef: { id: "b2", version: 1 },
  profileRef: { id: "p2", version: 1 },
};

describe("operational authority binding and ordered pins", () => {
  it("enforces one active binding and immutable ordered primary/auxiliary pins", () => {
    const set = ConfigurationPinSet.create([primary, auxiliary]);
    expect(set.entries.map(({ logicalRole }) => logicalRole)).toEqual([
      "QA_REQUEST_AUTHORITY",
      "SOURCE_CONTEXT",
    ]);
    expect(() => (set.entries as unknown as unknown[]).push(primary)).toThrow();
    const binding = OperationalAuthorityBindingAggregate.create({
      id: "ob",
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      connectionHeaderId: "tenant",
      externalEntityType: "OPERATIONAL_REQUEST",
      externalEntityId: "10001",
    });
    expect(binding.activate()).toBe(binding);
    expect(() => binding.activate()).toThrow("BINDING_ALREADY_ACTIVE");
  });

  it("rejects native links across authority namespaces", () => {
    expect(() =>
      ConfigurationPinSet.create([
        primary,
        { ...auxiliary, authorityNamespaceHash: "sha256:other" },
      ]).assertLinkStrategy("NATIVE_SAME_AUTHORITY"),
    ).toThrow("CROSS_AUTHORITY_NATIVE_LINK_FORBIDDEN");
  });
});
