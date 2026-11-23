import { describe, expect, it, vi } from "vitest";

import { QaDefectPublicationService } from "../../../packages/competency-qa/src/application/defect-publication.ts";
import { buildReadyDefectDraft } from "../../support/002-us4-fixtures.ts";

describe("AT-009 defect publication live authorization", () => {
  it.each([
    ["REQUESTER", "HUMAN"],
    ["QA_EXECUTOR", "SERVICE"],
    ["QA_EXECUTOR", "AGENT"],
  ])("denies role=%s actor=%s with zero connector calls", async (role, kind) => {
    const invoke = vi.fn();
    const service = new QaDefectPublicationService({
      invoke,
      now: () => "2026-08-30T12:00:00.000Z",
    });
    await expect(
      service.publish({
        draft: buildReadyDefectDraft(),
        actor: { kind, principalId: "principal-1" },
        role,
        permission: "qa.defect.publish",
        approval: {
          state: "APPROVED",
          expiresAt: "2026-08-30T13:00:00.000Z",
          subjectHashExact: true,
          bindingProfileExact: true,
          consumed: false,
        },
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["REJECTED", true, true, false],
    ["APPROVED", false, true, false],
    ["APPROVED", true, false, false],
    ["APPROVED", true, true, true],
  ] as const)(
    "blocks state=%s exact=%s binding=%s consumed=%s",
    async (state, subjectHashExact, bindingProfileExact, consumed) => {
      const invoke = vi.fn();
      const service = new QaDefectPublicationService({
        invoke,
        now: () => "2026-08-30T12:00:00.000Z",
      });
      await expect(
        service.publish({
          draft: buildReadyDefectDraft(),
          actor: { kind: "HUMAN", principalId: "executor-1" },
          role: "QA_EXECUTOR",
          permission: "qa.defect.publish",
          approval: {
            state,
            expiresAt: "2026-08-30T13:00:00.000Z",
            subjectHashExact,
            bindingProfileExact,
            consumed,
          },
        }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("allows one exact current Executor/Lead consumption and rejects a concurrent replay", async () => {
    const invoke = vi.fn(async () => ({ externalEntityId: "DEF-1", effectId: "effect-1" }));
    const service = new QaDefectPublicationService({
      invoke,
      now: () => "2026-08-30T12:00:00.000Z",
    });
    const draft = buildReadyDefectDraft();
    const input = {
      draft,
      actor: { kind: "HUMAN", principalId: "executor-1" },
      role: "QA_EXECUTOR",
      permission: "qa.defect.publish" as const,
      approval: {
        state: "APPROVED" as const,
        expiresAt: "2026-08-30T13:00:00.000Z",
        subjectHashExact: true,
        bindingProfileExact: true,
        consumed: false,
      },
    };
    const results = await Promise.allSettled([service.publish(input), service.publish(input)]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
