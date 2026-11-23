import { describe, expect, it } from "vitest";

import { JiraConfigurationLifecycle } from "../../../packages/connector-jira/src/index.ts";

describe("Jira configuration lifecycle", () => {
  it("requires bootstrap -> discovery -> validated and immutable profile versions", () => {
    const lifecycle = new JiraConfigurationLifecycle();
    const bootstrap = lifecycle.bootstrap({
      id: "c",
      version: 1,
      family: "jira-cloud-v3",
      exactBuild: "local",
      baseUrl: "http://127.0.0.1:3010",
    });
    const snapshot = lifecycle.recordDiscovery(bootstrap, {
      contentHash: "sha256:discovery",
      capabilities: { search: true },
    });
    const validated = lifecycle.validateConnection(bootstrap, snapshot);
    expect(validated.stage).toBe("VALIDATED");
    const profile = lifecycle.publishProfile({
      id: "p",
      version: 1,
      connection: validated,
      contentHash: "sha256:p",
      mappingHash: "sha256:m",
    });
    expect(() => lifecycle.publishProfile({ ...profile, contentHash: "sha256:changed" })).toThrow(
      "PUBLISHED_PROFILE_IMMUTABLE",
    );
  });

  it("keeps preview/dry-run read only and drift profile-local", async () => {
    const lifecycle = new JiraConfigurationLifecycle();
    const result = await lifecycle.dryRun("p", async (method) => method);
    expect(result).toEqual(["GET", "HEAD"]);
    expect(lifecycle.markDrift("p", "FIELD_MISSING").profileId).toBe("p");
  });
});
