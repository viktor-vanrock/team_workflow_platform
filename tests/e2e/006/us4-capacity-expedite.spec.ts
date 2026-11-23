import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type QaQueueEntryView,
  QaQueueItem,
} from "../../../packages/competency-qa/src/ui/queue-item.tsx";
import { runQueueScenario } from "../../../tools/local/queue-scenario.mts";

const render = renderToStaticMarkup as (node: ReturnType<typeof QaQueueItem>) => string;

const entry: QaQueueEntryView = {
  queueEntryId: "entry-us4",
  revision: 3,
  semanticHash: "sha256:entry",
  inputFingerprint: "sha256:input",
  stage: "ACTIVE",
  stageDetails: ["manual review"],
  stageReasonCodes: ["QA_ACTIVITY_ACTIVE"],
  subject: { kind: "WORK_ITEM", id: "wi" },
  operational: {
    state: "KNOWN",
    rawStatus: { name: "In Progress" },
    normalizedStatus: "IN_PROGRESS",
    externalDisplayKey: "QA-42",
  },
  control: { state: "ACCEPTED", resourceVersion: 4, serviceClass: "EXPEDITE" },
  freshness: { state: "CURRENT", evaluatedAt: "2026-09-03T09:00:00Z" },
  consistencyWarnings: [],
};

describe("US4 capacity and EXPEDITE UI", () => {
  it("explains reservation, soft signal, hard denial, and exact override provenance", () => {
    const markup = render(
      QaQueueItem({
        entry,
        capacity: {
          occupancy: "RESERVED_REVIEW",
          policyMode: "ENFORCED",
          projectWarning: "RESERVATION_PRESSURE",
          reservationRef: {
            sourceId: "reservation-1",
            sourceVersion: 2,
            semanticHash: "sha256:reservation",
          },
          denial: { reasonCode: "HARD_WIP", decisionId: "decision-1" },
          override: {
            actionKind: "WIP_ADMISSION_OVERRIDE",
            approvalId: "approval-1",
            approvedBy: "lead-2",
            expiresAt: "2026-09-03T10:00:00Z",
          },
        },
        onRequestWipOverride: () => undefined,
        onRequestExpedite: () => undefined,
      }),
    );
    expect(markup).toContain("Зарезервировано для проверки");
    expect(markup).toContain("Высокая нагрузка на резерв");
    expect(markup).toContain("Допуск отклонён: Жёсткий лимит WIP");
    expect(markup).toContain("Исключение допуска WIP");
    expect(markup).toContain("approval-1");
    expect(markup).toContain("Запросить срочный приоритет");
  });

  it("shows occupied claim provenance without any global capacity head", () => {
    const markup = render(
      QaQueueItem({
        entry,
        capacity: {
          occupancy: "OCCUPIED",
          policyMode: "MEASURE_ONLY",
          projectWarning: "NOT_CONFIGURED",
          claimRef: { sourceId: "claim-1", sourceVersion: 1, semanticHash: "sha256:claim" },
        },
      }),
    );
    expect(markup).toContain("Заявка WIP claim-1, редакция 1");
    expect(markup).not.toMatch(/capacity head|global|workspaceHumanWipLimit/iu);
  });

  it("drives the policy, reservation, last-slot, override, EXPEDITE, overflow, and block/resume journeys", async () => {
    const ids = [
      "us4-measure-only-observation",
      "us4-automated-launch-reserves-review",
      "us4-terminal-result-converts-reservation",
      "us4-concurrent-last-slot",
      "us4-exact-wip-override",
      "us4-concurrent-expedite-singleton",
      "us4-expedite-clear-and-expiry-lock",
      "us4-forced-external-overflow",
      "us4-blocked-release-and-resume",
    ] as const;
    const results = await Promise.all(
      ids.map(async (id) => await runQueueScenario(id, { mode: "TEST" })),
    );
    expect(results.map(({ id, status }) => [id, status])).toEqual(ids.map((id) => [id, "PASS"]));
  });
});
