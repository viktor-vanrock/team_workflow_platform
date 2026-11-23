import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import {
  localHermesContext,
  parseHermesContextRequest,
  parseHermesContextResponse,
  runHermesContext,
} from "../../../packages/runtime-composition/src/hermes/project-context.ts";
import {
  localHermesProposal,
  parseHermesProposal,
  parseHermesRequest,
} from "../../../packages/runtime-composition/src/hermes/service-contract.ts";

const input = () =>
  parseHermesContextRequest({
    schemaVersion: 1,
    requestKey: randomUUID(),
    operation: "test",
    message: "Проверить оплату",
    context: {
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      version: 1,
      key: "ALPHA",
      name: "Альфа",
      purpose: "Проверка приложения",
      stage: "DRAFT",
      capability: "MANUAL_ONLY",
    },
  });
it("rejects foreign response hashes and extra context fields", () => {
  const request = input();
  expect(() =>
    parseHermesContextRequest({
      ...request,
      context: { ...request.context, documents: ["foreign"] },
    }),
  ).toThrow();
  expect(() => parseHermesContextResponse(localHermesContext(input()), request)).toThrow();
  const project = parseHermesRequest({
    schemaVersion: 1,
    workspaceId: randomUUID(),
    principalId: randomUUID(),
    dialogueId: randomUUID(),
    requestKey: randomUUID(),
    expectedVersion: 1,
    draft: { key: "P-TEST" },
    message: "Альфа",
  });
  expect(() =>
    parseHermesProposal({ ...localHermesProposal(project), requestHash: "foreign" }, project),
  ).toThrow();
});
it("prepares only allowlisted QA fields without grants or model-owned scope", async () => {
  expect(
    await runHermesContext(input(), async () => ({
      title: "Оплата",
      requestKind: "smoke",
      goal: "Проверить оплату",
    })),
  ).toMatchObject({ mode: "MODEL", proposal: { requestKind: "smoke" } });
  expect(
    (await runHermesContext(input(), async () => ({ title: "Оплата", projectId: randomUUID() })))
      .mode,
  ).toBe("DETERMINISTIC_FALLBACK");
});
it("does not turn model questions into actions or active external links", async () => {
  const request = { ...input(), operation: "ask" as const };
  expect(
    (await runHermesContext(request, async () => ({ answer: "https://evil.invalid" }))).mode,
  ).toBe("DETERMINISTIC_FALLBACK");
  expect((await runHermesContext(request, async () => new Promise(() => {}), 20)).mode).toBe(
    "DETERMINISTIC_FALLBACK",
  );
});
