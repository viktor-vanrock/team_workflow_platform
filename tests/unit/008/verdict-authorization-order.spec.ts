import { expect, it, vi } from "vitest";

import { QaVerdictCompletionController } from "../../../apps/api/src/extensions/qa-verdict-completion.controller.ts";
import { DurableQaDodRuntime } from "../../../packages/runtime-composition/src/pilot/dod-runtime.ts";

it("authorizes verdict supersession before looking up any scoped record", async () => {
  const query = vi.fn(async () => []);
  const controller = new QaVerdictCompletionController(
    { query } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    controller.supersedeVerdict(
      { headers: {} },
      "workspace",
      "project",
      "work",
      "verdict",
      'W/"1"',
      {} as never,
      { setHeader: vi.fn() },
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(query).not.toHaveBeenCalled();
});

it("denies DoD before SQL and keeps unexpected adapter diagnostics out of HTTP errors", async () => {
  const query = vi.fn(async () => []);
  const source = { query } as never;
  const controller = new QaVerdictCompletionController(
    source,
    new DurableQaDodRuntime(source, {} as never),
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    controller.assessDod({ headers: {} }, "workspace", "project", "work", {} as never),
  ).rejects.toMatchObject({ status: 403 });
  expect(query).not.toHaveBeenCalled();
  const failed = new QaVerdictCompletionController(
    source,
    {
      assess: async () => {
        throw new Error("provider credential canary");
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    failed.assessDod({ headers: {} }, "workspace", "project", "work", {} as never),
  ).rejects.toThrow("QA_VERDICT_COMPLETION_FAILED");
});
