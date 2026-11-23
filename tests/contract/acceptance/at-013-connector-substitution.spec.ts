import { describe, expect, it } from "vitest";

import { CapabilityRegistry } from "../../../packages/platform-core/src/integration-registry/capability-registry.ts";

const contract = {
  key: "sample.record",
  version: "1.0.0",
  operations: [
    {
      key: "record.publish",
      effect: "WRITE" as const,
      idempotencyStrategies: ["NATIVE_KEY" as const],
      confirmationModes: ["SYNC_RECEIPT" as const],
    },
  ],
};

describe("AT-013 Connector substitution", () => {
  it("selects another implementation through the Profile without changing Pack requirement", () => {
    const registry = new CapabilityRegistry();
    registry.registerContract(contract);
    registry.registerImplementation({
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      capabilityKey: "sample.record",
      exactContractVersion: "1.0.0",
      operations: [
        {
          key: "record.publish",
          idempotencyStrategies: ["NATIVE_KEY"],
          confirmationModes: ["SYNC_RECEIPT"],
        },
      ],
    });
    registry.registerImplementation({
      connectorRef: { key: "sample.alternate", version: "1.0.0" },
      capabilityKey: "sample.record",
      exactContractVersion: "1.0.0",
      operations: [
        {
          key: "record.publish",
          idempotencyStrategies: ["NATIVE_KEY"],
          confirmationModes: ["SYNC_RECEIPT"],
        },
      ],
    });

    const requirement = Object.freeze({
      capabilityKey: "sample.record",
      versionRange: ">=1.0.0 <2.0.0",
      logicalRole: "PRIMARY",
      operation: "record.publish",
    });
    expect(
      registry.resolveImplementation(requirement, { key: "sample.mock", version: "1.0.0" })
        .connectorRef.key,
    ).toBe("sample.mock");
    expect(
      registry.resolveImplementation(requirement, { key: "sample.alternate", version: "1.0.0" })
        .connectorRef.key,
    ).toBe("sample.alternate");
    expect(requirement).toEqual(expect.objectContaining({ logicalRole: "PRIMARY" }));
  });
});
