import { describe, expect, it } from "vitest";

import { intersectOperationStrategies } from "../../../packages/platform-core/src/integration-registry/capability-registry.ts";

describe("AT-018 strategy intersection", () => {
  const contract = {
    idempotencyStrategies: ["NATIVE_KEY", "RECONCILIATION"] as const,
    confirmationModes: ["SYNC_RECEIPT", "READ_BACK"] as const,
  };
  const implementation = {
    idempotencyStrategies: ["NATIVE_KEY", "NATURAL_KEY_LOOKUP"] as const,
    confirmationModes: ["SYNC_RECEIPT", "WEBHOOK"] as const,
  };

  it.each([
    ["NATIVE_KEY", "SYNC_RECEIPT", true],
    ["RECONCILIATION", "SYNC_RECEIPT", false],
    ["NATIVE_KEY", "READ_BACK", false],
    ["NATURAL_KEY_LOOKUP", "WEBHOOK", false],
  ] as const)("validates %s + %s", (idempotency, confirmation, accepted) => {
    expect(
      intersectOperationStrategies(contract, implementation, {
        idempotencyStrategy: idempotency,
        confirmationMode: confirmation,
      }).accepted,
    ).toBe(accepted);
  });
});
