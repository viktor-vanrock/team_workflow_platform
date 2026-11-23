import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  deterministicQaAutomationResultReviewPacket,
  type QaAutomationResultReviewPacketInput,
} from "../../../packages/competency-qa/src/index.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { AgentRunAggregate } from "../../../packages/platform-core/src/index.ts";
import {
  createHermesComposition,
  type QaAutomationReviewPacketFacts,
  qaAutomationReviewPacketSchemaId,
  qaAutomationReviewPacketSkillDefinition,
  qaProposalSkillContribution,
} from "../../../packages/runtime-composition/src/index.ts";

const generatedAt = new Date("2026-09-02T10:00:00.000Z");
const hash = (key: string) => sha256({ key });

function facts(): QaAutomationReviewPacketFacts {
  return Object.freeze({
    testSessionId: "session-1",
    attemptSetHash: hash("attempt-set"),
    attempts: Object.freeze([
      Object.freeze({
        automationAttemptId: "attempt-2",
        attemptNo: 2,
        outcome: "PASS" as const,
        resultHash: hash("result-2"),
      }),
      Object.freeze({
        automationAttemptId: "attempt-1",
        attemptNo: 1,
        outcome: "ASSERTION_FAILED" as const,
        resultHash: hash("result-1"),
      }),
    ]),
    artifactReferences: Object.freeze(["artifact-2", "artifact-1", "artifact-1"]),
    findingDrafts: Object.freeze([
      Object.freeze({
        title: "Проверить расхождение результата",
        suggestedClassification: "PRODUCT" as const,
        evidenceRefs: Object.freeze(["artifact:artifact-2", "artifact:artifact-1"]),
      }),
    ]),
    flakySuspected: true,
    quarantineWarnings: Object.freeze([
      Object.freeze({
        quarantineId: "quarantine-1",
        subject: Object.freeze({
          kind: "INFRASTRUCTURE_CODE" as const,
          infrastructureCode: "RUNNER_LOST",
        }),
        currentRevisionNo: 3,
        currentRevisionHash: hash("quarantine-revision-3"),
        effectiveState: "ACTIVE" as const,
      }),
    ]),
    unresolvedChecks: Object.freeze(["FLAKY_DISPOSITION_REQUIRED" as const]),
  });
}

describe("Feature 005 optional Hermes automation review packet", () => {
  it("builds the exact proposal-only schema from summaries and references only", () => {
    const packet = deterministicQaAutomationResultReviewPacket({
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      ...facts(),
      generatedAt,
      artifactBytes: new Uint8Array([115, 101, 99, 114, 101, 116]),
      providerLocator: "provider://must-not-leak",
    } as QaAutomationResultReviewPacketInput & Record<string, unknown>);

    expect(() =>
      designContractRegistry.validateById(qaAutomationReviewPacketSchemaId, packet as never),
    ).not.toThrow();
    expect(packet.proposalOnly).toBe(true);
    expect(packet.attempts.map(({ automationAttemptId }) => automationAttemptId)).toEqual([
      "attempt-1",
      "attempt-2",
    ]);
    expect(packet.artifactReferences).toEqual(["artifact-1", "artifact-2"]);
    expect(packet.findingDrafts[0]?.suggestedClassification).toBe("PRODUCT");
    expect(packet.unresolvedChecks).toEqual([
      "FLAKY_DISPOSITION_REQUIRED",
      "QUARANTINE_WARNING_UNDISPOSED",
    ]);
    expect(JSON.stringify(packet)).not.toContain("secret");
    expect(JSON.stringify(packet)).not.toContain("provider://");
    const { contentHash, ...unsigned } = packet;
    expect(contentHash).toBe(sha256(unsigned as never));
  });

  it("statically installs the schema-bound executor only when its loader is supplied", async () => {
    const base = createHermesComposition();
    expect(base.registry.resolve("qa-result-review-prep", "1.0.0").outputSchemaRef.id).not.toBe(
      qaAutomationReviewPacketSchemaId,
    );

    const composition = createHermesComposition(new Map(), undefined, {
      load: async ({ workspaceId, projectId, subject }) => {
        expect({ workspaceId, projectId, subjectId: subject.id }).toEqual({
          workspaceId: "workspace-1",
          projectId: "project-1",
          subjectId: "work-item-1",
        });
        return facts();
      },
    });
    const skill = composition.registry.resolve("qa-result-review-prep", "1.0.0");
    expect(skill.outputSchemaRef.id).toBe(qaAutomationReviewPacketSchemaId);
    const run = AgentRunAggregate.start({
      id: "agent-run-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      requestKey: "review-packet-1",
      requestPayload: { testSessionId: "session-1" },
      subject: Object.freeze({
        kind: "WORK_ITEM" as const,
        id: "work-item-1",
        version: 7,
        contentHash: hash("work-item"),
        aggregateSnapshotHash: hash("work-item-snapshot"),
      }),
      humanPrincipalId: "qa-executor-1",
      servicePrincipalId: "hermes-service",
      grants: Object.freeze([]),
    });
    composition.runs.enqueue(run.snapshot(), skill);

    await expect(composition.executor.runOne()).resolves.toBe(1);
    const completed = composition.runs.get("agent-run-1")!;
    expect(completed.status).toBe("FALLBACK_COMPLETED");
    expect(completed.result).toMatchObject({
      schemaVersion: "result-review-packet@1.0.0",
      workItemId: "work-item-1",
      proposalOnly: true,
    });
  });

  it("publishes the optional definition without a provider compile dependency", () => {
    expect(qaProposalSkillContribution.optionalExtensions).toEqual([
      expect.objectContaining({
        definition: qaAutomationReviewPacketSkillDefinition,
        proposalOnly: true,
      }),
    ]);
    const source = readFileSync(
      new URL(
        "../../../packages/runtime-composition/src/hermes/qa-automation-review-packet.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/connector-gitlab|connector-mattermost|\/gitlab\/|\/mattermost\//u);
  });
});
