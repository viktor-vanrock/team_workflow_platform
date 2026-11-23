import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runProjectModel } from "../../../packages/runtime-composition/src/hermes/project-model.ts";
import { parseHermesRequest } from "../../../packages/runtime-composition/src/hermes/service-contract.ts";

const input = () =>
  parseHermesRequest({
    schemaVersion: 1,
    workspaceId: randomUUID(),
    principalId: randomUUID(),
    dialogueId: randomUUID(),
    requestKey: randomUUID(),
    expectedVersion: 1,
    draft: { key: "P-TEST" },
    message: "Нужен личный кабинет с историей заказов",
  });
describe("Hermes model boundary", () => {
  it("uses only a validated proposal and leaves the input unchanged", async () => {
    const request = input(),
      before = structuredClone(request);
    const result = await runProjectModel(request, async (draft, message) => {
      expect(draft).toEqual({ key: "P-TEST" });
      expect(message).toBe(request.message);
      return { key: "P-TEST", name: "Личный кабинет", purpose: "История заказов" };
    });
    expect(result).toMatchObject({
      mode: "MODEL",
      state: "READY",
      draft: { name: "Личный кабинет" },
    });
    expect(request).toEqual(before);
  });
  it.each([
    { key: "P-TEST", name: "X", grants: ["admin"] },
    { key: "../admin" },
    { key: "P-TEST", name: "a".repeat(257) },
    null,
  ])("rejects unsafe output %j", async (output) => {
    expect((await runProjectModel(input(), async () => output)).mode).toBe(
      "DETERMINISTIC_FALLBACK",
    );
  });
  it("bounds a provider ignoring abort and never exposes its failure", async () => {
    let signal: AbortSignal | undefined;
    const result = await runProjectModel(
      input(),
      async (_draft, _message, s) => {
        signal = s;
        return new Promise(() => {});
      },
      20,
    );
    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({
      mode: "DETERMINISTIC_FALLBACK",
      reasonCode: "MODEL_UNAVAILABLE",
    });
    expect(
      JSON.stringify(
        await runProjectModel(input(), async () => {
          throw new Error("SECRET");
        }),
      ),
    ).not.toContain("SECRET");
  });
});
