import { describe, expect, it } from "vitest";

import { buildCompletionSummary } from "../../../packages/competency-qa/src/domain/completion.ts";
import { createOperationalWorkItemMockConnector } from "../../../packages/connector-mock/src/operational-work-item.connector.ts";
import {
  assertOperationalRequestTransition,
  type OperationalRequestTransitionInput,
} from "../../../packages/connector-sdk/src/operational-work-item.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const profileRef = Object.freeze({ id: "33333333-3333-4333-8333-333333333333", version: 4 });
const target = Object.freeze({
  workspaceId,
  projectId,
  entityKind: "REQUEST" as const,
  authorityScopeKey: "qa.alpha",
  externalEntityId: "REQ-qa-fail-1",
});
const summary = buildCompletionSummary({
  workspaceId,
  projectId,
  workItemId: "44444444-4444-4444-8444-444444444444",
  verdictRef: { id: "verdict-1", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
  verdict: "FAIL",
  residualRisk: "Linked product defect remains open",
  evidenceManifestRefs: [{ id: "manifest-1", version: 1, contentHash: `sha256:${"b".repeat(64)}` }],
  defectLinkOrDispositionRefs: [
    { kind: "DEFECT_LINK", id: "link-1", version: 1, contentHash: `sha256:${"c".repeat(64)}` },
  ],
});
const payload: OperationalRequestTransitionInput = Object.freeze({
  requestedNormalizedStatus: "DONE",
  expectedExternalVersion: "3",
  completionSummary: summary,
});

describe("request.transition DONE + FAIL conformance", () => {
  it("requires the full closed structured summary and rejects READY-with-summary", () => {
    expect(() => assertOperationalRequestTransition(payload)).not.toThrow();
    expect(() =>
      assertOperationalRequestTransition({ ...payload, requestedNormalizedStatus: "READY" }),
    ).toThrow("SCHEMA_DRIFT");
    expect(summary.verdict).toBe("FAIL");
    expect(JSON.stringify(summary)).not.toMatch(/release|canonicalClosed/i);
  });

  it("Mock Connector renders and confirms one identical DONE summary receipt", async () => {
    const effects = new Map<string, unknown>();
    const connector = createOperationalWorkItemMockConnector({
      createRequest: async () => {
        throw new Error("unused");
      },
      readRequestEffect: async () => undefined,
      createDefect: async () => {
        throw new Error("unused");
      },
      readDefectEffect: async () => undefined,
      transitionRequest: async (request) => {
        const result = Object.freeze({
          operation: "request.transition" as const,
          entityKind: "REQUEST" as const,
          externalEntityId: target.externalEntityId,
          externalDisplayKey: target.externalEntityId,
          externalVersion: "4",
          rawExternalState: "MOCK_DONE",
          normalizedStatus: "DONE" as const,
          naturalKey: "qa-fail-1",
          effectId: request.effectIdempotencyKey,
          observedAt: "2026-08-31T12:00:00.000Z",
          completionSummaryReceipt: {
            id: `comment:${request.effectIdempotencyKey}`,
            contentHash: request.payload.completionSummary!.contentHash,
          },
          scope: request.scope,
          profileRef: request.profileRef,
        });
        effects.set(request.effectIdempotencyKey, result);
        return result;
      },
      readRequestTransitionEffect: async ({ effectIdempotencyKey }) =>
        effects.get(effectIdempotencyKey) as never,
    });
    const context = {
      scope: { kind: "PROJECT" as const, workspaceId, projectId },
      actor: { kind: "SERVICE" as const, principalId: "worker", serviceKey: "worker.local" },
      correlationId: "correlation-1",
      causationId: "causation-1",
      effectIdempotencyKey: "effect:done:1",
      profileRef,
      classification: { key: "INTERNAL", rank: 2 },
      signal: new AbortController().signal,
    };
    const result = await connector.operations.requestTransition.handler.invoke(
      context,
      target,
      payload,
    );
    expect(result).toMatchObject({
      normalizedStatus: "DONE",
      completionSummaryReceipt: { contentHash: summary.contentHash },
    });
    expect(
      await connector.readRequestTransitionByEffect(context, target, context.effectIdempotencyKey),
    ).toEqual(result);
  });

  it("a second implementation preserves FAIL while deriving only operational DONE", () => {
    const invoke = (input: OperationalRequestTransitionInput) => {
      assertOperationalRequestTransition(input);
      return Object.freeze({
        normalizedStatus: "DONE" as const,
        verdict: input.completionSummary!.verdict,
        summaryHash: input.completionSummary!.contentHash,
      });
    };
    expect(invoke(payload)).toEqual({
      normalizedStatus: "DONE",
      verdict: "FAIL",
      summaryHash: summary.contentHash,
    });
  });
});
