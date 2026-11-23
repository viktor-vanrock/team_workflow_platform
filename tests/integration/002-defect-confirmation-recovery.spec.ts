import { describe, expect, it } from "vitest";

import {
  createQaDefectConfirmationHook,
  DefectLinkConfirmationStore,
} from "../../packages/competency-qa/src/application/defect-confirmation-hook.ts";
import { normalizeOperationalDefectCreateResult } from "../../packages/connector-mock/src/operational-work-item-confirmation.ts";
import { buildDispatchedDefectDraft } from "../support/002-us4-fixtures.ts";

describe("US4 defect effect recovery", () => {
  it("conforms Mock and a second implementation and normalizes the exact effect", () => {
    const target = {
      workspaceId: "workspace-1",
      projectId: "project-1",
      entityKind: "DEFECT" as const,
      authorityScopeKey: "qa.alpha",
      naturalKey: "finding-0001",
    };
    const raw = {
      operation: "defect.create" as const,
      entityKind: "DEFECT" as const,
      externalEntityId: "DEF-1",
      externalDisplayKey: "DEF-1",
      externalVersion: "1",
      rawExternalState: "MOCK_NEW",
      normalizedStatus: "NEW" as const,
      naturalKey: "finding-0001",
      effectId: "effect-1",
      observedAt: "2026-08-30T12:00:00.000Z",
      scope: { workspaceId: "workspace-1", projectId: "project-1" },
      profileRef: { id: "profile-1", version: 3 },
    };
    expect(
      normalizeOperationalDefectCreateResult(
        target,
        { id: "profile-1", version: 3 },
        "effect-1",
        raw,
      ),
    ).toMatchObject({
      operation: "defect.create",
      externalEntityId: "DEF-1",
      effectId: "effect-1",
    });
  });

  it("reconciles a crash after effect with one immutable DefectLink", async () => {
    const store = new DefectLinkConfirmationStore();
    const hook = createQaDefectConfirmationHook(store);
    const draft = buildDispatchedDefectDraft();
    store.register(draft);
    const input = {
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      commandId: draft.commandRef!.id,
      effectIdempotencyKey: "effect-1",
      capabilityKey: "operational-work-item",
      capabilityVersion: "1.0.0",
      operation: "defect.create",
      result: {
        operation: "defect.create",
        entityKind: "DEFECT",
        externalEntityId: "DEF-1",
        externalDisplayKey: "DEF-1",
        externalVersion: "1",
        rawExternalState: "MOCK_NEW",
        normalizedStatus: "NEW",
        naturalKey: "finding-0001",
        effectId: "effect-1",
        observedAt: "2026-08-30T12:00:00.000Z",
      },
      source: { sourceWorkItemId: draft.workItemId },
      bindingRef: draft.bindingRef!,
      profileRefs: draft.profileRefs!,
      correlationId: "correlation-1",
      causationId: "causation-1",
    } as const;
    const tx = {
      transactionId: "tx-1",
      native: {},
      contributionKey: hook.key,
      idempotencyKey: `${input.commandId}:confirmation:${hook.key}`,
    };
    const first = await hook.apply(input, tx);
    const replay = await hook.apply(input, tx);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(store.links()).toHaveLength(1);
    expect(store.links()[0]).toMatchObject({
      findingId: draft.findingId,
      externalEntityId: "DEF-1",
    });
  });
});
