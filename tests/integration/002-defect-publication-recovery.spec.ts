import { describe, expect, it } from "vitest";

import { MockOperationalService } from "../../apps/mock-hub/src/operational/operational.controller.ts";
import { InMemoryMockOperationalRepository } from "../../apps/mock-hub/src/operational/operational.repository.ts";
import { InMemoryMockStateRepository } from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import {
  createQaDefectConfirmationHook,
  DefectLinkConfirmationStore,
} from "../../packages/competency-qa/src/application/defect-confirmation-hook.ts";
import {
  QaDefectDraftAggregate,
  QaDefectDraftChain,
} from "../../packages/competency-qa/src/domain/defect-publication.ts";
import { createOperationalWorkItemMockConnector } from "../../packages/connector-mock/src/index.ts";
import type {
  ConnectorRuntimeContext,
  OperationalDefectCreateInput,
  OperationalDefectCreateResult,
  OperationalWorkItemTarget,
} from "../../packages/connector-sdk/src/index.ts";
import { createFrozenFinding } from "../support/002-us4-fixtures.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const profileRef = Object.freeze({ id: "33333333-3333-4333-8333-333333333333", version: 3 });
const target: OperationalWorkItemTarget = Object.freeze({
  workspaceId,
  projectId,
  entityKind: "DEFECT",
  authorityScopeKey: "qa.alpha",
  naturalKey: "finding-1",
});
const payload: OperationalDefectCreateInput = Object.freeze({
  sourceWorkItemId: "44444444-4444-4444-8444-444444444444",
  summary: "Checkout fails",
  description: "Frozen manual evidence reproduces the failure.",
  dataClassificationKey: "INTERNAL",
  sourceRefs: Object.freeze([
    {
      kind: "QA_FINDING_REVIEW",
      id: "55555555-5555-4555-8555-555555555555",
      version: "3",
      contentHash: `sha256:${"a".repeat(64)}` as const,
    },
  ]),
});
const context = (effectIdempotencyKey: string): ConnectorRuntimeContext => ({
  scope: { kind: "PROJECT", workspaceId, projectId },
  actor: {
    kind: "SERVICE",
    principalId: "66666666-6666-4666-8666-666666666666",
    serviceKey: "worker.local",
  },
  correlationId: "77777777-7777-4777-8777-777777777777",
  causationId: "88888888-8888-4888-8888-888888888888",
  effectIdempotencyKey,
  profileRef,
  classification: { key: "INTERNAL", rank: 2 },
  signal: new AbortController().signal,
});

interface Adapter {
  create(key: string): Promise<OperationalDefectCreateResult>;
  read(key: string): Promise<OperationalDefectCreateResult | undefined>;
}
const mockAdapter = (): Adapter => {
  const repository = new InMemoryMockOperationalRepository();
  const service = new MockOperationalService(
    repository,
    new InMemoryMockStateRepository(),
    () => "2026-08-30T12:00:00.000Z",
  );
  const connector = createOperationalWorkItemMockConnector({
    createRequest: async () => {
      throw new Error("request.create not used");
    },
    readRequestEffect: async () => undefined,
    transitionRequest: async () => {
      throw new Error("request.transition not used");
    },
    readRequestTransitionEffect: async () => undefined,
    createDefect: async (request) => await service.createDefect(request),
    readDefectEffect: async (request) =>
      (await repository.defectEffectByKey(request.scope, request.effectIdempotencyKey))?.result,
  });
  return {
    create: async (key) =>
      await connector.operations.defectCreate.handler.invoke(context(key), target, payload),
    read: async (key) => await connector.readDefectCreateByEffect(context(key), target, key),
  };
};
const secondAdapter = (): Adapter => {
  const effects = new Map<string, OperationalDefectCreateResult>();
  return {
    create: async (key) => {
      const current = effects.get(key);
      if (current) return current;
      const result: OperationalDefectCreateResult = Object.freeze({
        operation: "defect.create",
        entityKind: "DEFECT",
        externalEntityId: "ALT-DEF-1",
        externalDisplayKey: "ALT-DEF-1",
        externalVersion: "1",
        rawExternalState: "NEW",
        normalizedStatus: "NEW",
        naturalKey: "finding-1",
        effectId: key,
        observedAt: "2026-08-30T12:00:00.000Z",
      });
      effects.set(key, result);
      return result;
    },
    read: async (key) => effects.get(key),
  };
};

describe.each([
  ["Mock", mockAdapter],
  ["second in-memory", secondAdapter],
] as const)("defect.create conformance: %s", (_name, factory) => {
  it("reuses one effect key and reads back the exact normalized defect", async () => {
    const adapter = factory();
    const first = await adapter.create("effect:defect:1");
    expect(await adapter.create("effect:defect:1")).toEqual(first);
    expect(await adapter.read("effect:defect:1")).toEqual(first);
    expect(first).toMatchObject({
      operation: "defect.create",
      entityKind: "DEFECT",
      normalizedStatus: "NEW",
      naturalKey: "finding-1",
      effectId: "effect:defect:1",
    });
  });
});

const successor = (predecessor: QaDefectDraftAggregate) => {
  const finding = createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" });
  return new QaDefectDraftAggregate({
    defectDraftId: `draft-${predecessor.version + 1}`,
    version: predecessor.version + 1,
    finding,
    frozenReview: finding.currentReview!,
    payload: predecessor.payload,
    provenance: predecessor.provenance,
    createdBy: predecessor.createdBy,
    at: "2026-08-30T12:10:00.000Z",
    predecessorDraftRef: {
      id: predecessor.defectDraftId,
      version: predecessor.version,
      contentHash: predecessor.contentHash,
    },
  });
};
const initial = () => {
  const finding = createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" });
  return new QaDefectDraftAggregate({
    defectDraftId: "draft-1",
    version: 1,
    finding,
    frozenReview: finding.currentReview!,
    payload: {
      title: "Failure",
      description: "Failure details",
      stepsToReproduce: ["Reproduce"],
      expectedOutcome: "Pass",
      actualOutcome: "Fail",
      severity: "HIGH",
      target: { contentHash: `sha256:${"a".repeat(64)}` },
      evidenceRefs: [{ id: "artifact-1", version: "1", contentHash: `sha256:${"b".repeat(64)}` }],
    },
    provenance: { source: "DETERMINISTIC_TEMPLATE", templateVersion: "1.0.0" },
    createdBy: finding.createdBy,
    at: "2026-08-30T12:00:00.000Z",
  });
};

describe("immutable defect draft chain and crash recovery", () => {
  it.each(["FAILED", "INVALIDATED"] as const)(
    "permits exactly one no-gap successor from %s and preserves predecessor provenance",
    (terminal) => {
      const chain = new QaDefectDraftChain("finding-1");
      const first = initial();
      chain.append(first);
      if (terminal === "FAILED") first.fail("CONNECTOR_TIMEOUT", "Timeout after dispatch");
      else first.invalidate("WORDING_REPLACED");
      const next = successor(first);
      chain.append(next);
      expect(next.predecessorDraftRef).toEqual({
        id: first.defectDraftId,
        version: 1,
        contentHash: first.contentHash,
      });
      expect(() => chain.append(successor(first))).toThrow("QA_DEFECT_DRAFT_ACTIVE_HEAD_EXISTS");
    },
  );

  it.each(["REJECTED", "LINKED"] as const)(
    "treats %s as chain-final and never combines a link with a newer rejected head",
    (terminal) => {
      const chain = new QaDefectDraftChain("finding-1");
      const first = initial();
      chain.append(first);
      if (terminal === "REJECTED")
        first.reject({
          actor: first.createdBy,
          reason: "Human rejected publication",
          at: "2026-08-30T12:01:00.000Z",
        });
      else {
        first.accept({ actor: first.createdBy, at: "2026-08-30T12:01:00.000Z" });
        first.awaitApproval({
          bindingRef: { id: "binding-1", version: 3 },
          profileRefs: [profileRef],
          approvalRef: { id: "approval-1", subjectHash: `sha256:${"c".repeat(64)}` },
          at: "2026-08-30T12:02:00.000Z",
        });
        first.authorize("2026-08-30T12:03:00.000Z");
        first.dispatch({
          commandId: "command-1",
          effectKeyHash: `sha256:${"d".repeat(64)}`,
          at: "2026-08-30T12:04:00.000Z",
        });
        first.link("link-1");
      }
      expect(chain.currentProjection()).toMatchObject({
        resolved: true,
        ...(terminal === "LINKED" ? { defectLinkId: "link-1" } : {}),
      });
      expect(() => chain.append(successor(first))).toThrow("QA_DEFECT_DRAFT_CHAIN_FINAL");
    },
  );

  it("replays confirmation after crash-after-effect into exactly one immutable link", async () => {
    const draft = initial();
    draft.accept({ actor: draft.createdBy, at: "2026-08-30T12:01:00.000Z" });
    draft.awaitApproval({
      bindingRef: { id: "binding-1", version: 3 },
      profileRefs: [profileRef],
      approvalRef: { id: "approval-1", subjectHash: `sha256:${"c".repeat(64)}` },
      at: "2026-08-30T12:02:00.000Z",
    });
    draft.authorize("2026-08-30T12:03:00.000Z");
    draft.dispatch({
      commandId: "command-1",
      effectKeyHash: `sha256:${"d".repeat(64)}`,
      at: "2026-08-30T12:04:00.000Z",
    });
    const store = new DefectLinkConfirmationStore();
    store.register(draft);
    const hook = createQaDefectConfirmationHook(store);
    const effect = await mockAdapter().create("effect:defect:crash");
    const input = {
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      commandId: "command-1",
      effectIdempotencyKey: effect.effectId,
      capabilityKey: "operational-work-item",
      capabilityVersion: "1.0.0",
      operation: "defect.create",
      result: effect,
      source: { sourceWorkItemId: draft.workItemId },
      bindingRef: draft.bindingRef!,
      profileRefs: draft.profileRefs!,
      correlationId: "correlation-1",
      causationId: "causation-1",
    } as const;
    const transaction = {
      transactionId: "tx-1",
      native: {},
      contributionKey: hook.key,
      idempotencyKey: `command-1:confirmation:${hook.key}`,
    };
    expect((await hook.apply(input, transaction)).replayed).toBe(false);
    expect((await hook.apply(input, transaction)).replayed).toBe(true);
    expect(store.links()).toHaveLength(1);
  });
});
