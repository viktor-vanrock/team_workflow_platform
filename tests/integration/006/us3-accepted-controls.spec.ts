import { describe, expect, it, vi } from "vitest";

import { QaTriageAssessmentAggregate } from "../../../packages/competency-qa/src/index.ts";
import { TypeOrmQaTriageAssessmentRepository } from "../../../packages/competency-qa/src/persistence/triage-assessment.repository.ts";
import {
  queueControlDefaultState,
  type QueueControlRevision,
  type QueueControlState,
  UNKNOWN_QUEUE_PLANNING_VALUES,
} from "../../../packages/platform-core/src/index.ts";
import { QueueControlService } from "../../../packages/runtime-composition/src/index.ts";
import { digest, triageFixture } from "../../helpers/006/triage-fixture.ts";

const queueEntry = {
  queueEntryId: "queue-entry-1",
  revision: 5,
  semanticHash: digest("queue-entry:r5"),
  inputFingerprint: digest("queue-entry:inputs"),
} as const;
const operational = {
  sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
  sourceId: "jira-1",
  sourceVersion: 4,
  semanticHash: digest("jira:r4"),
  confirmedAt: "2026-09-03T08:00:00.000Z",
} as const;
const workItemRef = {
  sourceType: "WORK_ITEM_REVISION",
  sourceId: "work-item-1",
  sourceVersion: 7,
  semanticHash: digest("work-item:r7"),
} as const;
const policyRef = { id: "queue-policy-1", version: 2, semanticHash: digest("policy:r2") } as const;

function harness(currentAssessmentFingerprint?: string) {
  const output = triageFixture({ businessImpact: true });
  const assessment = QaTriageAssessmentAggregate.create({
    id: output.assessmentId,
    workspaceId: output.workspaceId,
    projectId: output.projectId,
    subject: output.subject,
    revision: output.revision,
    content: output,
    expiresAt: new Date(output.expiresAt),
  }).snapshot();
  let current: QueueControlState = queueControlDefaultState({
    controlId: "control-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    workItemId: "work-item-1",
    operationalProjectionRef: operational,
    qaSourceSetHash: digest("qa-set"),
    policyRef,
  });
  const history: QueueControlRevision[] = [];
  const actions = new Map<
    string,
    Readonly<{ publicIntentHash: string; revision: QueueControlRevision }>
  >();
  const emit = vi.fn();
  const service = new QueueControlService(
    {
      authorize: vi.fn().mockResolvedValue(true),
      read: vi.fn(async () => ({
        current,
        currentQueueEntry: queueEntry,
        workItemRef,
        assessment,
        currentAssessmentFingerprint: currentAssessmentFingerprint ?? output.inputFingerprint,
      })),
      commit: vi.fn(async ({ pair, revision }) => {
        const prior = actions.get(pair.actionId);
        if (prior) {
          if (prior.publicIntentHash !== pair.publicIntentHash)
            throw new Error("QUEUE_ACTION_IDEMPOTENCY_CONFLICT");
          return { replayed: true, revision: prior.revision };
        }
        actions.set(pair.actionId, { publicIntentHash: pair.publicIntentHash, revision });
        history.push(revision);
        current = {
          ...current,
          resourceVersion: revision.revision,
          currentRevisionId: revision.revisionId,
          serviceClass: revision.serviceClass,
          planningValues: revision.planningValues,
        };
        return { replayed: false, revision };
      }),
      emit,
    },
    () => new Date("2026-09-03T09:00:00.000Z"),
  );
  return {
    service,
    assessment,
    output,
    get current() {
      return current;
    },
    history,
    emit,
  };
}

describe("US3 accepted queue controls", () => {
  it("reads unchanged v1 history beside validated v1.1 revisions", async () => {
    const v11 = triageFixture();
    const modern = QaTriageAssessmentAggregate.create({
      id: v11.assessmentId,
      workspaceId: v11.workspaceId,
      projectId: v11.projectId,
      subject: v11.subject,
      revision: 2,
      content: { ...v11, revision: 2, previousAssessmentRef: `${v11.assessmentId}:r1` },
      expiresAt: new Date(v11.expiresAt),
    }).snapshot();
    const legacy = QaTriageAssessmentAggregate.create({
      id: "legacy",
      workspaceId: "workspace-1",
      projectId: "project-1",
      subject: v11.subject,
      revision: 1,
      content: {
        schemaVersion: "triage-assessment@1.0.0",
        facts: [
          {
            sourceRef: "jira:1",
            sourceVersion: "1",
            contentHash: digest("legacy-fact"),
            polarity: "UNKNOWN",
          },
        ],
        dimensions: { effortRange: { kind: "UNKNOWN" } },
        recommendations: { priority: { factRefs: [0] } },
      },
      expiresAt: new Date(v11.expiresAt),
    }).snapshot();
    const row = (value: typeof modern) => ({
      id: `${value.id}:r${value.revision}`,
      workspace_id: value.workspaceId,
      project_id: value.projectId,
      subject: value.subject,
      revision: value.revision,
      content: value.content,
      content_hash: value.contentHash,
      source_fact_set_hash: value.sourceFactSetHash,
      state: value.state,
      expires_at: value.expiresAt.toISOString(),
    });
    const source = { query: vi.fn().mockResolvedValue([row(legacy), row(modern)]) } as never;
    const history = await new TypeOrmQaTriageAssessmentRepository(source).history(
      "workspace-1",
      "project-1",
      "WORK_ITEM",
      "work-item-1",
    );
    expect(history.map(({ content }) => content.schemaVersion)).toEqual([
      "triage-assessment@1.0.0",
      "triage-assessment@1.1.0",
    ]);
    expect(history[0]!.content).toEqual(legacy.content);
  });

  it("records exact before/after values and assessment provenance while preserving service class", async () => {
    const h = harness();
    const acceptedValues = {
      risk: "HIGH" as const,
      businessImpact: "MEDIUM" as const,
      dependencyReadiness: "READY" as const,
      effortRange: { kind: "ESTIMATE" as const, lower: 1, upper: 3, unit: "PERSON_DAYS" as const },
    };
    const request = {
      schemaVersion: "queue-control-command@1.0.0" as const,
      requestKey: "accept-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      principalId: "human-1",
      commandKind: "ACCEPT_PLANNING_VALUES" as const,
      expectedControlVersion: 0,
      expectedQueueEntry: queueEntry,
      acceptedValues,
      triageAssessmentRef: {
        sourceType: "TRIAGE_ASSESSMENT_REVISION",
        sourceId: h.assessment.id,
        sourceVersion: h.assessment.revision,
        semanticHash: h.assessment.contentHash,
      },
      reason: "Lead accepts selected planning values",
    };
    const first = await h.service.request(request);
    expect(first).toMatchObject({
      state: "CONSUMED",
      approvalRequired: false,
      resultRef: { sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION" },
    });
    expect(h.history[0]).toMatchObject({
      serviceClass: "STANDARD",
      planningValues: acceptedValues,
      acceptedEffect: {
        kind: "ACCEPT_PLANNING_VALUES",
        before: UNKNOWN_QUEUE_PLANNING_VALUES,
        after: acceptedValues,
      },
      acceptedSourceRefs: expect.arrayContaining([
        expect.objectContaining({ sourceType: "TRIAGE_ASSESSMENT_REVISION" }),
      ]),
    });
    expect(JSON.stringify(h.history[0])).not.toMatch(/jiraPriority|assignment|jiraStatus/u);
    const replay = await h.service.request(request);
    expect(replay.replayed).toBe(true);
    expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it("guards FIXED_DATE proof, dedicated EXPEDITE, clear transitions, CAS and source drift", async () => {
    const h = harness();
    const base = {
      schemaVersion: "queue-control-command@1.0.0" as const,
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      principalId: "human-1",
      expectedQueueEntry: queueEntry,
      reason: "Date commitment",
    };
    await expect(
      h.service.request({
        ...base,
        requestKey: "bad-date",
        commandKind: "SET_FIXED_DATE",
        expectedControlVersion: 0,
        requestedServiceClass: "FIXED_DATE",
      }),
    ).rejects.toThrow("QUEUE_CONTROL_CONFIRMED_DUE_DATE_REQUIRED");
    await expect(
      h.service.request({
        ...base,
        requestKey: "expedite",
        commandKind: "SET_EXPEDITE",
        expectedControlVersion: 0,
        requestedServiceClass: "EXPEDITE",
        reviewAt: "2026-09-04T08:00:00Z",
        expiresAt: "2026-09-04T08:00:00Z",
      }),
    ).rejects.toThrow("QUEUE_CONTROL_EXPEDITE_DEDICATED_ACTION_REQUIRED");
    await h.service.request({
      ...base,
      requestKey: "date",
      commandKind: "SET_FIXED_DATE",
      expectedControlVersion: 0,
      requestedServiceClass: "FIXED_DATE",
      confirmedDueDateRef: operational,
    });
    expect(h.current).toMatchObject({
      serviceClass: "FIXED_DATE",
      planningValues: UNKNOWN_QUEUE_PLANNING_VALUES,
    });
    await expect(
      h.service.request({
        ...base,
        requestKey: "stale",
        commandKind: "CLEAR_SERVICE_CLASS",
        expectedControlVersion: 0,
        requestedServiceClass: "STANDARD",
      }),
    ).rejects.toThrow("QUEUE_CONTROL_CAS_CONFLICT");
    await h.service.request({
      ...base,
      requestKey: "clear",
      commandKind: "CLEAR_SERVICE_CLASS",
      expectedControlVersion: 1,
      requestedServiceClass: "STANDARD",
    });
    expect(h.current.serviceClass).toBe("STANDARD");

    const drifted = harness(digest("changed-current-assessment-inputs"));
    await expect(
      drifted.service.request({
        ...base,
        requestKey: "accept-after-source-drift",
        commandKind: "ACCEPT_PLANNING_VALUES",
        expectedControlVersion: 0,
        acceptedValues: { risk: "HIGH", businessImpact: "MEDIUM", dependencyReadiness: "READY" },
        triageAssessmentRef: {
          sourceType: "TRIAGE_ASSESSMENT_REVISION",
          sourceId: drifted.assessment.id,
          sourceVersion: drifted.assessment.revision,
          semanticHash: drifted.assessment.contentHash,
        },
      }),
    ).rejects.toThrow("QUEUE_CONTROL_TRIAGE_ASSESSMENT_SOURCE_DRIFT");
  });
});
