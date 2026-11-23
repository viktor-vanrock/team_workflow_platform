import { describe, expect, it } from "vitest";

import type {
  PipelineLookupRequest,
  PipelineLookupResult,
  PipelineTriggerReceipt,
} from "../../../packages/connector-sdk/src/index.ts";
import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  assertGitLabEffectLookup,
  assertGitLabEffectReceipt,
  jiraEffectQuarantineReason,
} from "../../../packages/runtime-composition/src/pilot/effect-confirmation.ts";

const hash = (char: string) => `sha256:${char.repeat(64)}` as const;
const now = new Date("2026-09-01T08:01:00Z");
const effect = {
  triggerRequestHash: hash("a"),
  markerHash: hash("b"),
  expectedCommitSha: "a".repeat(40),
  creationWindowStart: "2026-09-01T08:00:00Z",
  creationWindowEnd: "2026-09-01T08:02:00Z",
};
function receipt(patch: Partial<PipelineTriggerReceipt> = {}): PipelineTriggerReceipt {
  const body = {
    schemaVersion: "test-executor.trigger-status@1.0.0" as const,
    messageType: "RESULT" as const,
    operation: "pipeline.trigger" as const,
    externalPipelineId: "201",
    sourceCommitSha: effect.expectedCommitSha,
    observedState: "RUNNING" as const,
    providerCreatedAt: "2026-09-01T08:00:05Z",
    observedAt: now.toISOString(),
    triggerRequestHash: effect.triggerRequestHash,
    effectMarkerHash: effect.markerHash,
    ...patch,
  };
  return { ...body, observationHash: sha256(body as unknown as JsonValue) };
}
describe("008 provider confirmation identity", () => {
  it("validates actual provider identity, canonical bytes and times independently of the adapter", () => {
    expect(() => assertGitLabEffectReceipt(effect, receipt(), now)).not.toThrow();
    for (const patch of [
      { sourceCommitSha: "b".repeat(40) },
      { triggerRequestHash: hash("c") },
      { effectMarkerHash: hash("c") },
      { externalPipelineId: "../201" },
      { providerCreatedAt: "2026-09-01T07:59:59Z" },
      { providerCreatedAt: "2026-09-01T08:02:01Z" },
      { observedAt: "2026-09-01T08:00:04Z" },
      { observedAt: "2026-09-01T08:01:01Z" },
      { observedAt: "invalid" },
    ]) {
      expect(() => assertGitLabEffectReceipt(effect, receipt(patch), now)).toThrow(
        "GITLAB_EFFECT_CONFIRMATION_INVALID",
      );
    }
    expect(() =>
      assertGitLabEffectReceipt(effect, { ...receipt(), observationHash: hash("f") }, now),
    ).toThrow();
  });
  it("requires the original lookup window and a complete result envelope", () => {
    const request: PipelineLookupRequest = {
      schemaVersion: "test-executor.trigger-status@1.0.0",
      messageType: "REQUEST",
      operation: "pipeline.lookup",
      automationAttemptId: "attempt",
      effectMarkerHash: effect.markerHash,
      triggerRequestHash: effect.triggerRequestHash,
      expectedTargetCommitment: hash("d"),
      windowStart: effect.creationWindowStart,
      windowEnd: effect.creationWindowEnd,
    };
    const result: PipelineLookupResult = {
      schemaVersion: request.schemaVersion,
      messageType: "RESULT",
      operation: "pipeline.lookup",
      outcome: "ZERO",
      observedWindow: { start: request.windowStart, end: request.windowEnd },
      consistencyEvidenceHash: hash("e"),
    };
    expect(() => assertGitLabEffectLookup(request, result)).not.toThrow();
    for (const invalid of [
      { ...result, observedWindow: { start: "2026-09-01T08:00:01Z", end: request.windowEnd } },
      { ...result, consistencyEvidenceHash: "unverified" },
      { ...result, outcome: "MULTIPLE", matchCommitmentHashes: [hash("e")] },
    ])
      expect(() => assertGitLabEffectLookup(request, invalid as PipelineLookupResult)).toThrow(
        "GITLAB_EFFECT_LOOKUP_INVALID",
      );
  });
  it("makes ambiguous Jira results terminal without classifying normal lookup as failure", () => {
    expect(jiraEffectQuarantineReason("AMBIGUOUS")).toBe("JIRA_EFFECT_UNRESOLVED");
    expect(jiraEffectQuarantineReason("FAILED_FINAL")).toBe("JIRA_EFFECT_FAILED_FINAL");
    expect(jiraEffectQuarantineReason("LOOKUP_REQUIRED")).toBeUndefined();
  });
});
