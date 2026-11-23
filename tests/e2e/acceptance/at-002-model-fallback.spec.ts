import { describe, expect, it, vi } from "vitest";

import { DeterministicModelGateway } from "../../../packages/runtime-composition/src/model/deterministic-model.ts";

describe("AT-002 deterministic model fallback", () => {
  it.each([
    [undefined, "MODEL_PROVIDER_UNSET"],
    ["unknown-provider", "MODEL_PROVIDER_INVALID"],
    ["timeout", "MODEL_PROVIDER_TIMEOUT"],
  ] as const)(
    "falls back for provider %s without calling Mock Hub",
    async (provider, reasonCode) => {
      const mockHub = vi.fn();
      const gateway = new DeterministicModelGateway({
        ...(provider === undefined ? {} : { provider }),
        timeoutMs: 5,
        mockHub,
      });
      const result = await gateway.complete({
        prompt: "summarize local fixture",
        correlationId: "00000000-0000-4000-8000-000000000001",
      });

      expect(result).toEqual({
        provider: "deterministic-dummy",
        reasonCode,
        text: "Dummy model response: summarize local fixture",
      });
      expect(mockHub).not.toHaveBeenCalled();
    },
  );

  it("uses the deterministic fake model when configured", async () => {
    const gateway = new DeterministicModelGateway({ provider: "deterministic-fake" });
    await expect(gateway.complete({ prompt: "hello", correlationId: "c" })).resolves.toEqual({
      provider: "deterministic-fake",
      reasonCode: "MODEL_PROVIDER_CONFIGURED",
      text: "Fake model response: hello",
    });
  });
});
