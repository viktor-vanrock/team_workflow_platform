import { describe, expect, it, vi } from "vitest";

import { MattermostRestClient } from "../../../../packages/connector-mattermost/src/http/mattermost-rest-client.ts";

describe("Mattermost production boundary", () =>
  it("fails before resolving credentials or network", async () => {
    const fetcher = vi.fn();
    const client = new MattermostRestClient({
      baseUrl: "https://mattermost.example",
      environmentClass: "PRODUCTION",
      allowedHosts: [],
      credential: { use: vi.fn() },
      fetcher,
    });
    await expect(client.get("/api/v4/system/ping")).rejects.toThrow(/PRODUCTION/u);
    expect(fetcher).not.toHaveBeenCalled();
  }));
