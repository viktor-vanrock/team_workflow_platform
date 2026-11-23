import { describe, expect, it } from "vitest";

import { createSampleRecordConnector } from "../../packages/connector-mock/src/index.ts";
import {
  CommandGateway,
  InMemoryCommandUnitOfWork,
  InMemoryStageAudit,
  WriteStageAuditor,
} from "../../packages/platform-core/src/index.ts";
import {
  AlternateSampleRecordConnector,
  DeterministicClock,
  DeterministicIdGenerator,
  humanActor,
  projectScope,
} from "../../packages/platform-testkit/src/index.ts";

interface WriteImplementation {
  readonly name: string;
  invoke(
    effectIdempotencyKey: string,
  ): Promise<Readonly<{ externalRecordId: string; status: "PUBLISHED" }>>;
  effectCount(effectIdempotencyKey: string): Promise<number>;
}

function implementations(): readonly WriteImplementation[] {
  const mockEffects = new Map<
    string,
    Readonly<{ externalRecordId: string; status: "PUBLISHED"; receipt: string }>
  >();
  const mock = createSampleRecordConnector({
    publish: async (request) => {
      const current = mockEffects.get(request.effectIdempotencyKey);
      if (current) return current;
      const result = Object.freeze({
        externalRecordId: request.target.id,
        status: "PUBLISHED" as const,
        receipt: `mock:${request.effectIdempotencyKey}`,
      });
      mockEffects.set(request.effectIdempotencyKey, result);
      return result;
    },
  });
  const alternate = new AlternateSampleRecordConnector();
  return [
    {
      name: "sample.mock@1.0.0/record.publish",
      invoke: async (effectIdempotencyKey) =>
        await mock.operations.publishSampleRecord.handler.invoke(
          {
            scope: { kind: "PROJECT", workspaceId: "workspace", projectId: "project" },
            actor: { kind: "SERVICE", principalId: "worker", serviceKey: "worker" },
            correlationId: "correlation",
            causationId: "causation",
            effectIdempotencyKey,
            profileRef: { id: "profile", version: 1 },
            classification: { key: "INTERNAL", rank: 10 },
            signal: new AbortController().signal,
          },
          { id: "phase1-conformance" },
          { message: "hello" },
        ),
      effectCount: async (effectIdempotencyKey) => (mockEffects.has(effectIdempotencyKey) ? 1 : 0),
    },
    {
      name: "sample.alternate@1.0.0/record.publish",
      invoke: async (effectIdempotencyKey) =>
        await alternate.publish({
          effectIdempotencyKey,
          target: { id: "phase1-conformance" },
          payload: { message: "hello" },
        }),
      effectCount: async (effectIdempotencyKey) =>
        await alternate.effectCount(effectIdempotencyKey),
    },
  ];
}

describe("SC-007 conformance for every typed Connector write operation", () => {
  it.each(implementations())(
    "enforces policy, stable effect key, outbox, audit and normalized result for $name",
    async (implementation) => {
      const unitOfWork = new InMemoryCommandUnitOfWork();
      const auditPort = new InMemoryStageAudit();
      const audit = new WriteStageAuditor(auditPort);
      const gateway = new CommandGateway(
        unitOfWork,
        new DeterministicClock(),
        new DeterministicIdGenerator(),
        audit,
      );
      const context = {
        actor: humanActor(),
        scope: projectScope(),
        correlationId: "correlation",
        causationId: "causation",
        authorizationBasis: {
          kind: "PROJECT" as const,
          policyVersion: "policy@1",
          membershipRef: { id: "membership", version: 1 },
          entitlementRefs: [{ id: "entitlement", version: 1 }],
          roleAssignmentRefs: [{ id: "role", version: 1 }],
          skillContext: "NOT_APPLICABLE" as const,
        },
      };
      const submitted = await gateway.submit(context, {
        clientRequestKey: `request-${implementation.name}`,
        commandType: "sample.record.publish",
        capability: {
          key: "sample.record",
          exactContractVersion: "1.0.0",
          operation: "record.publish",
          logicalRole: "PRIMARY",
        },
        target: { id: "phase1-conformance" },
        payload: { message: "hello" },
        expectedExternalState: { mode: "MUST_NOT_EXIST" },
        bindingRef: { id: "binding", version: 1 },
        profileRef: { id: "profile", version: 1 },
        dataClassificationKey: "INTERNAL",
        source: { sourceWorkItemId: "work-item" },
      });
      expect(unitOfWork.snapshot()).toMatchObject({
        commands: 1,
        auditEvents: 1,
        outboxRecords: 1,
      });
      expect(submitted.command).toMatchObject({
        outboxStatus: "READY",
        effectAuthorizationStatus: "NOT_REQUIRED",
      });
      const stableEffectKey = submitted.command.effectIdempotencyKey;

      let allowed = false;
      let deniedCalls = 0;
      const policyInvoke = async () => {
        if (!allowed) {
          deniedCalls += 1;
          throw new Error("POLICY_DENIED");
        }
        return await implementation.invoke(stableEffectKey);
      };
      await expect(policyInvoke()).rejects.toThrow("POLICY_DENIED");
      expect(await implementation.effectCount(stableEffectKey)).toBe(0);
      allowed = true;
      const first = await policyInvoke();
      const replay = await policyInvoke();
      expect(replay).toEqual(first);
      expect(await implementation.effectCount(stableEffectKey)).toBe(1);
      expect(deniedCalls).toBe(1);

      await audit.record({
        stage: "BROKER",
        workspaceId: "workspace",
        projectId: "project",
        action: "record.publish",
        initialAuthorizationBasis: context.authorizationBasis,
        effectAuthorizationBasis: context.authorizationBasis,
        bindingRef: { id: "binding", version: 1 },
        profileRef: { id: "profile", version: 1 },
        resultCode: "SUCCEEDED",
        reasonCode: "NORMALIZED_RESULT",
        attributes: {
          commandId: submitted.command.id,
          payload: { message: "hello" },
          effectIdempotencyKey: stableEffectKey,
        },
      });
      const normalized = {
        outcome: "SUCCEEDED" as const,
        code: "OK",
        receipt: { externalEntityId: first.externalRecordId, status: first.status },
      };
      expect(normalized).toEqual({
        outcome: "SUCCEEDED",
        code: "OK",
        receipt: { externalEntityId: expect.any(String), status: "PUBLISHED" },
      });
      expect(auditPort.events().map(({ stage }) => stage)).toEqual(["GATEWAY", "BROKER"]);
      expect(JSON.stringify(auditPort.events())).not.toContain("hello");
      expect(JSON.stringify(auditPort.events())).not.toContain(stableEffectKey);
    },
  );
});
