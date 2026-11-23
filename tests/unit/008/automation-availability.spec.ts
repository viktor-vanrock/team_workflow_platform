import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import {
  PublishedQaAutomationAvailability,
  type QaAutomationAvailabilityPins,
} from "../../../packages/runtime-composition/src/pilot/automation-availability.ts";

export const availabilityPins = (): QaAutomationAvailabilityPins => {
  const ref = () => ({
    id: randomUUID(),
    version: 1,
    contentHash: `sha256:${"a".repeat(64)}` as const,
  });
  return {
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    bindingRef: ref(),
    contextRef: ref(),
    suiteBindingId: randomUUID(),
    suiteRef: ref(),
    suiteValidationRef: ref(),
    bindingValidationRef: ref(),
    acceptanceRef: ref(),
    environmentRef: ref(),
    evidencePolicyRef: ref(),
    maximumEvidenceAgeMs: 60_000,
    roles: ["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"].map((logicalRole) => ({
      logicalRole,
      profileRef: ref(),
      connectionRef: ref(),
    })) as QaAutomationAvailabilityPins["roles"],
  };
};
it("requires all role pins and current request authority before database access", async () => {
  const transaction = vi.fn();
  const source = { transaction } as never;
  const pins = availabilityPins();
  expect(
    () => new PublishedQaAutomationAvailability(source, [{ ...pins, roles: pins.roles.slice(1) }]),
  ).toThrow("QA_AUTOMATION_CONFIGURATION_INVALID");
  const runtime = new PublishedQaAutomationAvailability(source, [pins]);
  await expect(runtime.current(pins)).rejects.toThrow("QA_AUTOMATION_ACCESS_DENIED");
  await expect(
    runtime.current(pins, {
      authorize: async () => {
        throw new Error("PRIVATE_AUTH_CANARY");
      },
    }),
  ).rejects.toThrow("QA_AUTOMATION_ACCESS_DENIED");
  expect(transaction).not.toHaveBeenCalled();
});
