import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createQueueStageTransition,
  validateQueueEntryProjection,
} from "../../../packages/platform-core/src/work-management/queue-stage.ts";

const root = resolve(import.meta.dirname, "../../..");
const schema = JSON.parse(
  readFileSync(
    resolve(
      root,
      "specs/006-queue-triage-capacity-sla/contracts/schemas/queue-entry.v1.schema.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const hash = `sha256:${"a".repeat(64)}` as const;

describe("US1 QueueEntry and stage transition contracts", () => {
  it("closes public source refs to Project-safe families", () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const sources = defs.publicSourceType!.enum as string[];
    expect(sources).toEqual([
      "INTAKE_CANDIDATE_REVISION",
      "INTAKE_DRAFT_REVISION",
      "WORK_ITEM_REVISION",
      "JIRA_OPERATIONAL_PROJECTION_REVISION",
      "JIRA_STATUS_MAPPING_REVISION",
      "QA_QUEUE_FACT_REVISION",
      "QA_READINESS_FACT_SET",
      "QA_TEST_SESSION_REVISION",
      "QA_AUTOMATED_ACTIVITY_FACT_SET",
      "QA_TRIAGE_ASSESSMENT_REVISION",
      "QA_VERDICT_REVISION",
      "WORK_ITEM_QUEUE_CONTROL_REVISION",
      "REVIEW_CAPACITY_RESERVATION_REVISION",
      "HUMAN_WIP_CLAIM_REVISION",
      "SLA_CLOCK_REVISION",
    ]);
    expect(sources.join(" ")).not.toMatch(/AUTHORIZATION|CAPACITY_HEAD|QUEUE_POLICY/iu);
  });

  it("rejects Candidate operational/SLA/WIP facets and Work Item missing exact authority refs", () => {
    expect(() =>
      validateQueueEntryProjection({
        subject: { kind: "CANDIDATE", candidateId: "c1" },
        stage: "CANDIDATE",
        operational: { state: "KNOWN" },
        capacity: { state: "OCCUPIED" },
        sla: { state: "PROJECTED", goals: [] },
        sourceRefs: [],
      }),
    ).toThrow(/CANDIDATE_OPERATIONAL_EFFECT_FORBIDDEN/u);
    expect(() =>
      validateQueueEntryProjection({
        subject: { kind: "WORK_ITEM", workItemId: "w1" },
        stage: "READY",
        operational: { state: "KNOWN" },
        capacity: { state: "NOT_CONSUMING" },
        sla: { state: "PROJECTED", goals: [] },
        sourceRefs: [],
      }),
    ).toThrow(/WORK_ITEM_SOURCE_REF_REQUIRED/u);
  });

  it("builds a sorted immutable transition between distinct exact revisions", () => {
    const transition = createQueueStageTransition({
      transitionId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      projectId: "10000000-0000-4000-8000-000000000003",
      previousQueueEntryRef: {
        schemaVersion: "queue-entry@1.0.0",
        queueEntryId: "10000000-0000-4000-8000-000000000004",
        revision: 1,
        semanticHash: hash,
      },
      currentQueueEntryRef: {
        schemaVersion: "queue-entry@1.0.0",
        queueEntryId: "10000000-0000-4000-8000-000000000004",
        revision: 2,
        semanticHash: `sha256:${"b".repeat(64)}`,
      },
      previousStage: "BACKLOG",
      currentStage: "READY",
      reasonCodes: ["READINESS_CONFIRMED", "JIRA_READY_CONFIRMED"],
      occurredAt: "2026-09-02T12:00:00.000Z",
    });
    expect(transition.reasonCodes).toEqual(["JIRA_READY_CONFIRMED", "READINESS_CONFIRMED"]);
    expect(transition.semanticHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(transition)).toBe(true);
    expect(() => createQueueStageTransition({ ...transition, currentStage: "BACKLOG" })).toThrow(
      /STAGE_TRANSITION_NO_OP/u,
    );
  });
});
