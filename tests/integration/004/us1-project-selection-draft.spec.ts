import { describe, expect, it } from "vitest";

import { ProjectSelectionService } from "../../../packages/runtime-composition/src/index.ts";

describe("US1 project selection", () =>
  it("invalidates prior option sets and creates revision one once", async () => {
    let creates = 0;
    const service = new ProjectSelectionService(
      {
        options: async () => [
          {
            workspaceId: "w",
            projectId: "p",
            workspaceLabel: "W",
            projectLabel: "P",
            configurationHash: "h",
          },
        ],
        reauthorize: async () => true,
      },
      () => new Date("2026-09-01"),
    );
    const first = await service.issue("u", "session");
    const second = await service.issue("u", "session");
    expect(service.snapshot(first.items[0]!.intentId)?.status).toBe("INVALIDATED");
    const input = {
      principalId: "u",
      oidcSessionId: "session",
      ...second.items[0]!,
      requestKey: "stable-request-key",
      createDraft: async () => {
        creates += 1;
        return { id: "d", resultRef: "draft:d:revision:1", draft: { revision: 1 } };
      },
    };
    expect(await service.consume(input)).toMatchObject({ replayed: false, draft: { revision: 1 } });
    expect(await service.consume(input)).toMatchObject({ replayed: true });
    expect(creates).toBe(1);
  }));
