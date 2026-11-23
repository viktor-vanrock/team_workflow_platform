import { describe, expect, it } from "vitest";

import { MockOperationalService } from "../../../apps/mock-hub/src/operational/operational.controller.ts";
import { InMemoryMockOperationalRepository } from "../../../apps/mock-hub/src/operational/operational.repository.ts";
import { InMemoryMockStateRepository } from "../../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import {
  confirmQaIntake,
  listConfirmedQaBacklog,
  onQaRequestConfirmed,
  publishQaProjectContext,
  publishQaRiskReviewPolicy,
  type QaCommandGatewayPort,
  type QaConfirmedDraft,
  type QaIntakeConfirmationWriter,
  type QaRequestExtension,
  type QaRequestInputRevision,
  QaWorkItemDetailSectionRegistry,
  type QaWorkspaceContext,
} from "../../../packages/competency-qa/src/node.ts";
import { createOperationalWorkItemMockConnector } from "../../../packages/connector-mock/src/index.ts";
import type { ConnectorRuntimeContext } from "../../../packages/connector-sdk/src/index.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const requester = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "33333333-3333-4333-8333-333333333333",
  issuer: "https://fake-idp.test",
  subject: "requester.alpha",
} as const);
const authorizationBasis = Object.freeze({
  kind: "PROJECT" as const,
  policyVersion: "qa-local@1",
  membershipRef: { id: "44444444-4444-4444-8444-444444444444", version: 1 },
  roleAssignmentRefs: [{ id: "55555555-5555-4555-8555-555555555555", version: 1 }],
  entitlementRefs: [{ id: "66666666-6666-4666-8666-666666666666", version: 1 }],
  skillContext: "NOT_APPLICABLE" as const,
} as const);
const context: QaWorkspaceContext = Object.freeze({
  actor: requester,
  scope: { kind: "PROJECT", workspaceId, projectId },
  correlationId: "77777777-7777-4777-8777-777777777777",
  causationId: "88888888-8888-4888-8888-888888888888",
  authorizationBasis,
} as const);
const bindingRef = Object.freeze({
  id: "99999999-9999-4999-8999-999999999999",
  version: 1,
} as const);
const profileRef = Object.freeze({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  version: 1,
} as const);
const digest = (char: string) => `sha256:${char.repeat(64)}` as const;
const immutable = (kind: string, id: string, char: string) =>
  Object.freeze({ kind, id, version: "1", contentHash: digest(char) } as const);

function fixture() {
  const risk = publishQaRiskReviewPolicy({
    policyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    version: 1,
    scope: { workspaceId, projectId },
    actor: requester,
    publishedAt: "2026-08-30T10:00:00.000Z",
  });
  const targetPolicy = immutable("target-policy", "qa-local-target", "1");
  const scopePolicy = immutable("scope-policy", "qa-local-scope", "2");
  const checklist = immutable("checklist-policy", "qa-manual-smoke", "3");
  const projectContext = publishQaProjectContext({
    contextId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    version: 1,
    workspaceId,
    projectId,
    allowedEnvironments: [
      { environmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", revision: 1, scope: "LOCAL" },
    ],
    allowedResponseChannelKinds: ["PLATFORM_WEB"],
    requestAuthorityRequirementKey: "qa-request-authority",
    defectDestinationRequirementKey: "defect-destination",
    allowedTargetPolicyRefs: [targetPolicy],
    allowedScopePolicyRefs: [scopePolicy],
    allowedChecklistPolicyRefs: [checklist],
    defaultTargetPolicyRef: targetPolicy,
    defaultScopePolicyRef: scopePolicy,
    defaultChecklistRefs: [checklist],
    projectRisk: "MEDIUM",
    maximumClassificationKey: "INTERNAL",
    dorRuleSetRef: { key: "qa.dor", version: "1.0.0", contentHash: digest("4") },
    dodRuleSetRef: { key: "qa.dod", version: "1.0.0", contentHash: digest("5") },
    evidencePolicyRef: { key: "qa.evidence", version: "1.0.0", contentHash: digest("6") },
    riskReviewPolicyRef: {
      id: risk.policyId,
      version: risk.version,
      contentHash: risk.contentHash,
    },
    createdBy: requester,
    publishedBy: requester,
    publishedAt: "2026-08-30T10:00:00.000Z",
  });
  const draft: QaConfirmedDraft = Object.freeze({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    version: 4,
    contentHash: digest("7"),
    workspaceId,
    projectId,
    definitionRef: { key: "qa.validation", version: "1.0.0" },
    state: "CONFIRMED",
    requester,
    payload: Object.freeze({
      schemaVersion: 1,
      title: "Retest checkout payment error",
      requestKind: "retest",
      requestedClassificationKey: "INTERNAL",
      defectRef: immutable("defect", "DEF-17", "8"),
      previousSessionRef: {
        kind: "EXTERNAL_HISTORICAL",
        historicalSessionRef: immutable("historical-session", "SESSION-9", "9"),
      },
      sourceBuildRef: immutable("build", "checkout-2026.08.30", "a"),
    } as const),
    authoritativeClassificationKey: "INTERNAL",
  } as const);
  return { risk, projectContext, draft };
}

describe("AT-002 confirmed sparse QA intake", () => {
  it("creates exactly one external request and one atomic local aggregate under concurrent replay", async () => {
    const { projectContext, draft } = fixture();
    const operational = new InMemoryMockOperationalRepository();
    const service = new MockOperationalService(
      operational,
      new InMemoryMockStateRepository(),
      () => "2026-08-30T10:01:00.000Z",
    );
    const connector = createOperationalWorkItemMockConnector({
      createRequest: async (request) => await service.createRequest(request),
      readRequestEffect: async (request) => {
        const result = (await operational.effectByKey(request.scope, request.effectIdempotencyKey))
          ?.result;
        if (result && result.operation !== "request.create")
          throw new Error("Unexpected transition receipt");
        return result;
      },
      transitionRequest: async () => {
        throw new Error("request.transition is outside this fixture");
      },
      readRequestTransitionEffect: async () => undefined,
    });
    const commandClaims = new Map<
      string,
      Readonly<{
        commandId: string;
        effectIdempotencyKey: string;
        status: string;
        replayed: boolean;
      }>
    >();
    const gateway: QaCommandGatewayPort = {
      submit: async (_context, intent) => {
        const current = commandClaims.get(intent.clientRequestKey);
        if (current) return { ...current, replayed: true };
        const created = Object.freeze({
          commandId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          effectIdempotencyKey: "awp:effect:ffffffff-ffff-4fff-8fff-ffffffffffff",
          status: "QUEUED",
          replayed: false,
        } as const);
        commandClaims.set(intent.clientRequestKey, created);
        return created;
      },
    };
    const responseChannels = {
      resolve: async () =>
        Object.freeze({
          state: "CONFIRMED" as const,
          requesterPrincipal: requester,
          resolutionPolicyRef: {
            key: "qa.response-channel-resolution",
            version: "1.0.0",
            contentHash: digest("b"),
          },
          responseChannelRef: {
            channelKind: "PLATFORM_WEB" as const,
            channelId: "12121212-1212-4212-8212-121212121212",
            version: 1,
            contentHash: digest("c"),
          },
          evaluatedAt: "2026-08-30T10:00:30.000Z",
        } as const),
    };

    // Merely saved/unconfirmed Drafts never enter this explicit confirmation path.
    expect(commandClaims.size).toBe(0);
    expect(await operational.effectCount()).toBe(0);

    const candidates = await Promise.all(
      [1, 2, 3, 4].map(
        async () =>
          await confirmQaIntake({
            context,
            draft,
            projectContext,
            responseChannels,
            bindingRef,
            profileRef,
            clientRequestKey: "client:qa-confirm:1",
            evaluatedAt: "2026-08-30T10:00:30.000Z",
            commandGateway: gateway,
          }),
      ),
    );
    expect(new Set(candidates.map((candidate) => candidate.command.commandId))).toEqual(
      new Set(["ffffffff-ffff-4fff-8fff-ffffffffffff"]),
    );
    expect(candidates[0]!.commandIntent.payload.summary).toBe(draft.payload.title);
    expect(candidates[0]!.commandIntent.payload).not.toHaveProperty("description");
    expect(candidates[0]!.commandIntent.payload).not.toHaveProperty("acceptanceOutcome");
    expect(candidates[0]!.command).not.toHaveProperty("clientRequestKey");

    const runtime: ConnectorRuntimeContext = {
      scope: { kind: "PROJECT", workspaceId, projectId },
      actor: {
        kind: "SERVICE",
        principalId: "13131313-1313-4313-8313-131313131313",
        serviceKey: "worker.local",
      },
      correlationId: context.correlationId,
      causationId: context.causationId,
      effectIdempotencyKey: candidates[0]!.command.effectIdempotencyKey,
      profileRef,
      classification: { key: "INTERNAL", rank: 2 },
      signal: new AbortController().signal,
    };
    const receipts = await Promise.all(
      candidates.map(
        async (candidate) =>
          await connector.operations.requestCreate.handler.invoke(
            runtime,
            candidate.commandIntent.target,
            candidate.commandIntent.payload,
          ),
      ),
    );
    expect(new Set(receipts.map((receipt) => receipt.externalEntityId)).size).toBe(1);
    expect(await operational.effectCount()).toBe(1);
    const external = await operational.requestById(
      { workspaceId, projectId },
      receipts[0]!.externalEntityId,
    );
    expect(external).toMatchObject({
      summary: draft.payload.title,
      dataClassificationKey: "INTERNAL",
    });
    expect(external).not.toHaveProperty("description");
    expect(external).not.toHaveProperty("acceptanceOutcome");

    const workItems = new Set<string>();
    const extensions = new Map<string, QaRequestExtension>();
    const revisions = new Map<string, QaRequestInputRevision>();
    const writer: QaIntakeConfirmationWriter = {
      persist: async (_transaction, aggregate) => {
        const current = extensions.get(aggregate.extension.workItemId);
        if (current) return { replayed: true };
        // Test UoW models Core Work Item + Pack rows as one commit boundary.
        workItems.add(aggregate.extension.workItemId);
        revisions.set(aggregate.extension.workItemId, aggregate.initialInput);
        extensions.set(aggregate.extension.workItemId, aggregate.extension);
        return { replayed: false };
      },
    };
    const material = candidates[0]!.validated;
    const hookResults = await Promise.all(
      receipts.map(
        async (receipt) =>
          await onQaRequestConfirmed({
            effect: {
              workspaceId,
              projectId,
              commandId: candidates[0]!.command.commandId,
              effectIdempotencyKey: candidates[0]!.command.effectIdempotencyKey,
              capabilityKey: "operational-work-item",
              capabilityVersion: "1.0.0",
              operation: "request.create",
              result: receipt,
              source: { intakeDraftId: draft.id },
              bindingRef,
              profileRefs: [profileRef],
              correlationId: context.correlationId,
              causationId: context.causationId,
              workItemId: "14141414-1414-4414-8414-141414141414",
            },
            transaction: {
              transactionId: "test-uow",
              native: {},
              contributionKey: "qa.request-create.confirmation",
              idempotencyKey: "confirm:qa:1",
            },
            materials: {
              load: async () => ({
                context,
                draft,
                projectContext,
                responseChannelResolution: material.responseChannelResolution,
                semanticInput: material.semanticInput,
                blockersDeclared: material.blockersDeclared,
                dependenciesDeclared: material.dependenciesDeclared,
              }),
            },
            writer,
            ids: {
              extensionId: () => "15151515-1515-4515-8515-151515151515",
              inputRevisionId: () => "16161616-1616-4616-8616-161616161616",
              eventId: () => "17171717-1717-4717-8717-171717171717",
            },
            recordedAt: "2026-08-30T10:02:00.000Z",
          }),
      ),
    );
    expect(workItems.size).toBe(1);
    expect(extensions.size).toBe(1);
    expect(revisions.size).toBe(1);
    expect(hookResults.filter((result) => !result.replayed)).toHaveLength(1);
    const extension = [...extensions.values()][0]!;
    const revision = [...revisions.values()][0]!;
    expect(extension).toMatchObject({
      projectContextRef: { id: projectContext.contextId, version: 1 },
      dorRuleSetRef: projectContext.dorRuleSetRef,
      dodRuleSetRef: projectContext.dodRuleSetRef,
      evidencePolicyRef: projectContext.evidencePolicyRef,
      riskReviewPolicyRef: projectContext.riskReviewPolicyRef,
    });
    expect(revision).toMatchObject({
      version: 1,
      title: draft.payload.title,
      requestKind: "retest",
      dataClassificationKey: "INTERNAL",
      blockersDeclared: false,
      dependenciesDeclared: false,
      responseChannelResolution: { state: "CONFIRMED" },
      operationalBindingRef: bindingRef,
      previousSessionRef: { kind: "EXTERNAL_HISTORICAL" },
    });

    const backlog = await listConfirmedQaBacklog(
      { extensions: async () => [...extensions.values()], input: async () => revision },
      { workspaceId, projectId },
    );
    expect(backlog).toHaveLength(1);
    const detail = await new QaWorkItemDetailSectionRegistry([
      {
        key: "qa.intake",
        order: 2000,
        load: async () => ({
          requestExtension: extension,
          requestInputHistory: {
            schemaVersion: 1,
            workspaceId,
            projectId,
            workItemId: extension.workItemId,
            extensionId: extension.extensionId,
            currentInputRevisionRef: extension.currentRequestInputRevisionRef,
            resourceVersion: extension.resourceVersion,
            revisions: [revision],
          },
        }),
      },
    ]).detail({ workspaceId, projectId, workItemId: extension.workItemId });
    expect(detail).toMatchObject({
      requestExtension: extension,
      requestInputHistory: { revisions: [revision] },
      operationalReadiness: { assessmentState: "NOT_EVALUATED" },
      requiredSessionPlanHistory: null,
    });
    for (const key of [
      "readinessAssessments",
      "waivers",
      "sessions",
      "sessionReviews",
      "planItems",
      "manualAttempts",
      "observations",
      "findings",
      "defectDrafts",
      "defectLinks",
      "verdicts",
      "dodAssessments",
      "completionCandidates",
      "finalCloseConfirmations",
    ])
      expect(detail[key]).toEqual([]);
  });
});
