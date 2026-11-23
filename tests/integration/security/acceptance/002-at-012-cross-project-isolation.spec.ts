import { describe, expect, it, vi } from "vitest";

import {
  FakeQaDraftAssistant,
  requestQaDefectDraftWordingProposal,
} from "../../../../packages/competency-qa/src/application/qa-draft-assistant.ts";
import { assertQaScopedRecord } from "../../../../packages/competency-qa/src/persistence/scoped-pack-store.ts";
import { normalizeOperationalRequestCreateResult } from "../../../../packages/connector-mock/src/operational-work-item-confirmation.ts";
import { InMemoryDurableCommandStore } from "../../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  type ArtifactAccessAuthorizer,
  type ArtifactReference,
  ArtifactService,
  consumeEffectAuthorization,
  createExactApproval,
  decideApproval,
  type ScopedArtifactRepository,
  type WorkspaceContext,
} from "../../../../packages/platform-core/src/index.ts";
import {
  CommandWorker,
  DeterministicClock,
  envelopeFromStore,
  InMemoryRecoverableQueue,
} from "../../../../packages/platform-testkit/src/index.ts";
import { createFrozenFinding } from "../../../support/002-us4-fixtures.ts";

const scope = Object.freeze({
  workspaceId: "workspace-alpha",
  projectId: "project-alpha",
} as const);
const context: WorkspaceContext = Object.freeze({
  actor: {
    kind: "HUMAN",
    principalId: "executor-alpha",
    issuer: "fake-idp",
    subject: "executor.alpha",
  },
  scope: { kind: "PROJECT", ...scope },
  correlationId: "correlation-alpha",
  causationId: "causation-alpha",
} as const);
const artifact: ArtifactReference = Object.freeze({
  id: "artifact-alpha",
  ...scope,
  owner: { entityType: "WORK_ITEM", entityId: "work-item-alpha" },
  artifactKind: "QA_EVIDENCE",
  storage: {
    providerKind: "LEGACY_EXTERNAL",
    opaqueLocator: "must-never-leak",
    objectVersionOrEtag: "v1",
  },
  fileName: "evidence.txt",
  mediaType: "text/plain",
  sizeBytes: 4,
  checksum: { algorithm: "SHA256", value: "sha256:test" },
  classification: { key: "RESTRICTED", rank: 20 },
  availability: "AVAILABLE",
  createdBy: "executor-alpha",
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
} as const);

describe("AT-012 cross-project and cross-Workspace isolation", () => {
  it("rejects a mixed-scope QA record before a child lookup", () => {
    const childLookup = vi.fn();
    expect(() => {
      assertQaScopedRecord(scope, { workspaceId: scope.workspaceId, projectId: "project-beta" });
      childLookup();
    }).toThrow("QA_SCOPE_MISMATCH");
    expect(childLookup).not.toHaveBeenCalled();
  });

  it("denies evidence before repository lookup or object storage resolve", async () => {
    const get = vi.fn(async () => artifact);
    const repository: ScopedArtifactRepository = { get, save: vi.fn(async () => undefined) };
    const authorizer: ArtifactAccessAuthorizer = {
      authorizeScope: vi.fn(async () => ({ allowed: false, reason: "NO_ENTITLEMENT" as const })),
      authorizeResource: vi.fn(async () => ({ allowed: true, reason: "ALLOW" as const })),
    };
    const storage = {
      stream: vi.fn(async () => ({
        body: (async function* () {
          yield new Uint8Array();
        })(),
      })),
    };
    await expect(
      new ArtifactService(repository, storage, authorizer).streamArtifactContent(
        context,
        artifact.id,
      ),
    ).rejects.toThrow("ARTIFACT_ACCESS_DENIED");
    expect(get).not.toHaveBeenCalled();
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it("denies restricted model input before the provider call", async () => {
    const assistant = new FakeQaDraftAssistant();
    const proposal = await requestQaDefectDraftWordingProposal({
      finding: createFrozenFinding({ classification: "PRODUCT", disposition: "CREATE_DEFECT" }),
      assistant,
      modelRef: {
        kind: "MODEL",
        id: "fake",
        version: "1",
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      dataClassificationKey: "RESTRICTED",
      now: () => "2026-08-31T00:00:00.000Z",
    });
    expect(proposal).toMatchObject({
      source: "DETERMINISTIC_FALLBACK",
      fallbackReasonCode: "MODEL_INPUT_DENIED",
    });
    expect(assistant.calls).toHaveLength(0);
  });

  it("invalidates an exact Approval whose live subject has cross-scope drift before effect invocation", async () => {
    const input = {
      id: "approval-alpha",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      initiatorId: "executor-alpha",
      initiator: context.actor,
      action: {
        actionKind: "EXTERNAL_COMMAND" as const,
        actionId: "command-alpha",
        commandType: "qa.complete",
        capabilityKey: "operational-work-item",
        capabilityVersion: "1.0.0",
        operation: "request.transition",
      },
      target: { workItemId: "work-item-alpha" },
      targetHash: `sha256:${"b".repeat(64)}`,
      payloadHash: `sha256:${"c".repeat(64)}`,
      expectedState: { projectId: scope.projectId, externalVersion: "3" },
      bindingRef: { id: "binding-alpha", version: 4 },
      profileRefs: [{ id: "profile-alpha", version: 4 }],
      requiredPermission: "qa.completion.approve",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" as const,
      effectIdempotencyKey: "effect-alpha",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
    };
    const approved = decideApproval(createExactApproval(input), {
      approverId: "lead-alpha",
      approverRole: "qa-lead",
      authorizationBasisHash: `sha256:${"d".repeat(64)}`,
      now: new Date("2026-08-31T00:01:00.000Z"),
    });
    const invoke = vi.fn();
    const consumed = await consumeEffectAuthorization(approved, {
      subjectHash: `sha256:${"e".repeat(64)}`,
      approverAuthorized: true,
      invalidationReason: "SCOPE_REVOKED",
      now: new Date("2026-08-31T00:02:00.000Z"),
    });
    if (consumed.effectAuthorizationStatus === "CONSUMED") invoke();
    expect(consumed).toMatchObject({
      effectAuthorizationStatus: "INVALIDATED",
      invalidationReason: "SCOPE_REVOKED",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a forged worker envelope before Broker/Connector", async () => {
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    queue.add({ ...envelopeFromStore(store), projectId: "project-beta" });
    const broker = { invoke: vi.fn(async () => ({ receipt: "forbidden" })) };
    await expect(
      new CommandWorker(store, queue, broker, new DeterministicClock()).work(),
    ).rejects.toThrow("JOB_ENVELOPE_MISMATCH");
    expect(broker.invoke).not.toHaveBeenCalled();
  });

  it("rejects a cross-Workspace Connector receipt before confirmation", () => {
    expect(() =>
      normalizeOperationalRequestCreateResult(
        {
          ...scope,
          entityKind: "REQUEST",
          authorityScopeKey: "qa.alpha",
          naturalKey: "request-alpha",
        },
        { id: "profile-alpha", version: 4 },
        "effect-alpha",
        {
          operation: "request.create",
          entityKind: "REQUEST",
          externalEntityId: "REQ-1",
          externalDisplayKey: "REQ-1",
          externalVersion: "1",
          rawExternalState: "MOCK_NEW",
          normalizedStatus: "NEW",
          naturalKey: "request-alpha",
          effectId: "effect-alpha",
          observedAt: "2026-08-31T00:00:00.000Z",
          scope: { workspaceId: "workspace-delta", projectId: scope.projectId },
          profileRef: { id: "profile-alpha", version: 4 },
        },
      ),
    ).toThrow("RESULT_SCOPE_MISMATCH");
  });
});
