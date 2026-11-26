import { describe, expect, it, vi } from "vitest";
import { createCorporateProbeAuthorization } from "../../../packages/runtime-composition/src/pilot/corporate-probe-authority.ts";

describe("corporate probe authorization", () => {
  it("accepts only the exact pinned chain and rechecks current connector permission", async () => {
    const ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` });
    const binding = {
      workspaceId: "workspace",
      projectId: "project",
      profileRef: ref("profile"),
      connectionRef: ref("connection"),
    };
    const target = {
      workspaceId: "workspace",
      projectId: "project",
      environmentScope: "NON_PROD",
      bindingRef: ref("binding"),
      profileRef: binding.profileRef,
      connectionRef: binding.connectionRef,
    };
    const authorize = vi.fn(async () => true);
    const check = createCorporateProbeAuthorization({
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      grants: [{ binding, integrationBindingRef: target.bindingRef }],
      authority: { authorize },
    } as never);
    const signal = new AbortController().signal;
    expect(await check(target as never, signal)).toBe(true);
    expect(authorize).toHaveBeenCalledWith(binding, "CONNECTOR_READ", signal);
    expect(await check({ ...target, projectId: "other" } as never, signal)).toBe(false);
    expect(
      await check({ ...target, profileRef: { ...target.profileRef, version: 2 } } as never, signal),
    ).toBe(false);
    expect(authorize).toHaveBeenCalledTimes(1);
  });
});
