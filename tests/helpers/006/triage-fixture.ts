import { deterministicQaTriageV11 } from "../../../packages/competency-qa/src/index.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";

export const digest = (value: JsonValue) => sha256(value);

export function triageFixture(
  input: Readonly<{ businessImpact?: boolean; revision?: number }> = {},
) {
  const subject = Object.freeze({
    kind: "WORK_ITEM" as const,
    id: "work-item-1",
    version: 7,
    contentHash: digest("work-item-1:r7"),
  });
  const components = Object.freeze({
    subject: Object.freeze({
      sourceType: "WORK_ITEM_REVISION" as const,
      sourceId: subject.id,
      sourceVersion: subject.version,
      semanticHash: subject.contentHash,
    }),
    jiraOperationalProjection: Object.freeze({
      state: "KNOWN" as const,
      sourceRef: Object.freeze({
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
        sourceId: "jira-1",
        sourceVersion: 4,
        semanticHash: digest("jira:r4"),
        confirmedAt: "2026-09-03T08:00:00.000Z",
      }),
    }),
    qaPlanningFacts: Object.freeze({
      state: "KNOWN" as const,
      sourceRef: Object.freeze({
        sourceType: "QA_QUEUE_FACT_REVISION" as const,
        sourceId: "qa-facts-1",
        sourceVersion: 3,
        semanticHash: digest("qa:r3"),
      }),
    }),
    automationFacts: Object.freeze({
      state: "NOT_APPLICABLE" as const,
      reasonCode: "AUTOMATION_NOT_CONFIGURED" as const,
    }),
  });
  return deterministicQaTriageV11({
    assessmentId: "assessment-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    subject,
    revision: input.revision ?? 1,
    facts: Object.freeze([
      Object.freeze({
        sourceRef: "qa-queue-fact:qa-facts-1:r3",
        sourceVersion: "3",
        contentHash: digest("qa-fact"),
        polarity: input.businessImpact ? ("SUPPORTS" as const) : ("UNKNOWN" as const),
        ...(input.businessImpact ? { dimension: "businessImpact" as const } : {}),
      }),
    ]),
    inputFingerprintComponents: components,
    agentRunId: "agent-run-1",
    now: new Date("2026-09-03T08:00:00.000Z"),
    expiresAt: new Date("2026-09-04T08:00:00.000Z"),
  });
}

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const asJson = (value: unknown): JsonValue => value as JsonValue;
