import { describe, expect, it, vi } from "vitest";

import { QaDefectPublicationService } from "../../../../packages/competency-qa/src/application/defect-publication.ts";
import { buildReadyDefectDraft } from "../../../support/002-us4-fixtures.ts";

describe("AT-009 live exact defect authorization", () => {
  it.each([
    ["QA_EXECUTOR", "HUMAN", true],
    ["QA_LEAD", "HUMAN", true],
    ["REQUESTER", "HUMAN", false],
    ["QA_EXECUTOR", "SERVICE", false],
    ["QA_EXECUTOR", "AGENT", false],
  ] as const)("role=%s actor=%s allowed=%s", async (role, kind, allowed) => {
    const invoke = vi.fn(async () => ({ externalEntityId: "DEF-1" }));
    const service = new QaDefectPublicationService({
      invoke,
      now: () => "2026-08-30T12:00:00.000Z",
    });
    const call = service.publish({
      draft: buildReadyDefectDraft(),
      actor: { kind, principalId: "executor-1" },
      role,
      permission: "qa.defect.publish",
      approval: {
        state: "APPROVED",
        expiresAt: "2026-08-30T13:00:00.000Z",
        subjectHashExact: true,
        bindingProfileExact: true,
        consumed: false,
      },
    });
    if (allowed) await expect(call).resolves.toBeDefined();
    else await expect(call).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it("denies expired, revoked/drifted and concurrently consumed authority", async () => {
    const invoke = vi.fn(async () => ({ externalEntityId: "DEF-1" }));
    const service = new QaDefectPublicationService({
      invoke,
      now: () => "2026-08-30T12:00:00.000Z",
    });
    for (const approval of [
      {
        state: "APPROVED" as const,
        expiresAt: "2026-08-30T11:59:59.000Z",
        subjectHashExact: true,
        bindingProfileExact: true,
        consumed: false,
      },
      {
        state: "REJECTED" as const,
        expiresAt: "2026-08-30T13:00:00.000Z",
        subjectHashExact: true,
        bindingProfileExact: true,
        consumed: false,
      },
      {
        state: "APPROVED" as const,
        expiresAt: "2026-08-30T13:00:00.000Z",
        subjectHashExact: false,
        bindingProfileExact: true,
        consumed: false,
      },
    ])
      await expect(
        service.publish({
          draft: buildReadyDefectDraft(),
          actor: { kind: "HUMAN", principalId: "executor-1" },
          role: "QA_EXECUTOR",
          permission: "qa.defect.publish",
          approval,
        }),
      ).rejects.toThrow();
    const draft = buildReadyDefectDraft();
    const valid = {
      draft,
      actor: { kind: "HUMAN", principalId: "executor-1" },
      role: "QA_EXECUTOR",
      permission: "qa.defect.publish",
      approval: {
        state: "APPROVED" as const,
        expiresAt: "2026-08-30T13:00:00.000Z",
        subjectHashExact: true,
        bindingProfileExact: true,
        consumed: false,
      },
    };
    const settled = await Promise.allSettled([service.publish(valid), service.publish(valid)]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  });
});
