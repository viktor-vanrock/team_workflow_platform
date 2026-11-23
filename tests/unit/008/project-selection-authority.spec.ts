import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { describe, expect, it, vi } from "vitest";

import { createMattermostProjectSelectionApi } from "../../../apps/api/src/extensions/mattermost-project-selection-api.ts";
import { QaSessionGuard } from "../../../apps/api/src/extensions/qa-api-authorization.ts";

describe("008 project selection authority", () => {
  it("requires a verified interaction session before inventory or SQL", async () => {
    const query = vi.fn();
    const transaction = vi.fn();
    const inventory = vi.fn();
    const api = createMattermostProjectSelectionApi({ query, transaction } as never, inventory);
    const request = {
      headers: {},
      localPersonaKey: "admin.platform",
      binding: `sha256:${"a".repeat(64)}`,
    };
    await expect(api.issue(request)).rejects.toThrow("QA_INTERACTION_SESSION_REQUIRED");
    await expect(
      api.consume(request, {
        intentId: "id",
        intentToken: "x".repeat(43),
        requestKey: "key".repeat(8),
      }),
    ).rejects.toThrow("QA_INTERACTION_SESSION_REQUIRED");
    expect(inventory).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("does not read labels for a denied scope or trust interaction fields on the request", async () => {
    const query = vi.fn();
    const transactionQuery = vi.fn(async () => []);
    const api = createMattermostProjectSelectionApi(
      {
        query,
        transaction: async (_level: string, run: (manager: unknown) => unknown) =>
          run({ query: transactionQuery }),
      } as never,
      async () => [{ workspaceId: "w", projectId: "p" }],
    );
    const request = { headers: {}, method: "POST", principalId: "forged" };
    await new QaSessionGuard({
      authenticate: async () => async () => {
        throw new Error("DENIED");
      },
      interaction: async () => ({ principalId: "canonical", binding: `sha256:${"a".repeat(64)}` }),
    }).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
    expect(await api.issue(request)).toEqual({ items: [] });
    expect(query).not.toHaveBeenCalled();
    expect(transactionQuery).toHaveBeenCalledTimes(1);
    expect(transactionQuery.mock.calls[0]).toEqual([
      expect.stringContaining("UPDATE interaction_intents"),
      ["canonical", expect.stringMatching(/^sha256:[a-f0-9]{64}$/u), 1],
    ]);
  });
});
