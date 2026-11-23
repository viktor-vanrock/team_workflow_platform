import { describe, expect, it } from "vitest";

import {
  createSafeCapabilityProbe,
  type SafeCapabilityProbeInput,
} from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";

const ref = { id: "pin", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const input: SafeCapabilityProbeInput = {
  workspaceId: "workspace",
  projectId: "project",
  probeId: "probe",
  bindingRef: ref,
  profileRef: ref,
  connectionRef: ref,
  validationReportRef: ref,
  logicalRole: "SOURCE_CONTEXT",
  capabilityKey: "source-context.read",
  exactContractVersion: "1.0.0",
  operation: "build.read",
  environmentScope: "NON_PROD",
  status: "AVAILABLE",
  safeIssueCodes: [],
  observedAt: "2026-09-04T00:00:00Z",
  validUntil: "2026-09-04T00:01:00Z",
};
describe("008 probe freshness boundary", () => {
  it("rejects invalid expiry and closed status/environment values", () => {
    for (const patch of [
      { validUntil: "invalid-date" },
      { validUntil: input.observedAt },
      { observedAt: "invalid-date" },
      { status: "UNKNOWN" },
      { environmentScope: "PLATFORM_PROD" },
    ])
      expect(() =>
        createSafeCapabilityProbe({ ...input, ...patch } as SafeCapabilityProbeInput),
      ).toThrow("CAPABILITY_PROBE_INVALID");
  });
  it("retains exact immutable scope/configuration pins for a valid observation", () => {
    const result = createSafeCapabilityProbe(input);
    expect(result).toMatchObject({
      profileRef: ref,
      bindingRef: ref,
      actorKind: "SERVICE",
      version: 1,
    });
    expect(Object.isFrozen(result.profileRef)).toBe(true);
  });
});
