import { describe, expect, it } from "vitest";

import { jiraConnectionRuntimeContent } from "../../packages/runtime-composition/src/jira/qa-command-materializer.ts";

describe("Jira connection runtime content", () => {
  it("prefers schema-bound configuration and preserves the stored document", () => {
    const stored = {
      endpoint: "http://legacy:4010",
      adapterFamily: "legacy",
      connectorConfiguration: {
        value: {
          baseUrl: "http://localhost:4010",
          environment: "LOCAL",
          adapterFamily: "jira-cloud-v3",
          adapterContractVersion: "1.0.0",
        },
      },
    };
    const runtime = jiraConnectionRuntimeContent(stored);
    expect(runtime).toMatchObject({
      endpoint: "http://localhost:4010",
      environmentScope: "LOCAL",
      adapterFamily: "jira-cloud-v3",
      adapterContractVersion: "1.0.0",
    });
    expect(stored.endpoint).toBe("http://legacy:4010");
    expect(stored.adapterFamily).toBe("legacy");
  });

  it("keeps legacy configurations and rejects malformed envelopes", () => {
    const legacy = { endpoint: "http://localhost:4010", adapterFamily: "jira-cloud-v3" };
    expect(jiraConnectionRuntimeContent(legacy)).toEqual(legacy);
    expect(() => jiraConnectionRuntimeContent({ connectorConfiguration: {} })).toThrow(
      "JIRA_CONNECTION_CONFIGURATION_INVALID",
    );
  });
});
