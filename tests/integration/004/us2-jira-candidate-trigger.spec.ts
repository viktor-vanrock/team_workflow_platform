import { describe, expect, it, vi } from "vitest";

import { JiraCandidateDiscovery } from "../../../packages/runtime-composition/src/index.ts";

const fact = {
  workspaceId: "w",
  projectId: "p",
  connectionId: "jira",
  externalEntityId: "ISSUE-1",
  externalVersion: "1",
  title: "Checkout",
  issueType: "Bug",
  status: "Open",
  labels: ["qa-intake"],
  classificationKey: "INTERNAL",
  observedAt: new Date("2026-09-01"),
};
describe("US2 Jira candidate trigger", () =>
  it("uses an authoritative read and stays separate from operational import", async () => {
    const discoverOrObserve = vi.fn<(input: unknown) => Promise<{ replayed: boolean }>>(
      async () => ({ replayed: false }),
    );
    const discovery = new JiraCandidateDiscovery(
      { discoverOrObserve },
      { issueTypes: ["Bug"], statuses: ["Open"], labelsAny: ["qa-intake"] },
    );
    expect(await discovery.discover(fact)).toMatchObject({ status: "OBSERVED" });
    expect(discoverOrObserve).toHaveBeenCalledOnce();
    expect(discoverOrObserve.mock.calls[0]![0]).not.toHaveProperty("workItemId");
    expect((await discovery.discover({ ...fact, labels: ["other"] })).status).toBe("NOT_TRIGGERED");
  }));
