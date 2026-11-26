import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeOrmCommandRepository } from "../../../packages/platform-persistence-typeorm/src/command.repository.ts";
import {
  createRetryCommandAdmission,
  createWorkerRetryAdmission,
  assertWorkerRetryHumanAccess,
} from "../../../packages/runtime-composition/src/pilot/retry-command-admission.ts";
import { TypeOrmScopedAccessRepository } from "../../../packages/platform-persistence-typeorm/src/identity-access.repository.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { PilotCommandAdmissionRepository } from "../../../packages/platform-persistence-typeorm/src/pilot-command-admission.repository.ts";
import { PilotCommandEffectGuard } from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate retry command admission", () => {
  it("rejects a retry when the human's project permission has been revoked", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      source: { causalHumanPrincipalId: "human" },
      dataClassificationKey: "INTERNAL",
    };
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM identities") ? [{ issuer: "issuer", subject: "subject" }] : [],
    );
    vi.spyOn(TypeOrmScopedAccessRepository.prototype, "getProject").mockResolvedValue({
      state: "ACTIVE",
      classification: { key: "INTERNAL", rank: 10 },
    } as never);
    vi.spyOn(TypeOrmScopedAccessRepository.prototype, "authorizationFacts").mockResolvedValue({
      roleAssignments: [],
      entitlements: [],
    } as never);
    await expect(
      assertWorkerRetryHumanAccess(
        { queryRunner: { isTransactionActive: true }, query } as never,
        command as never,
      ),
    ).rejects.toThrow("PILOT_RETRY_HUMAN_ACCESS_DENIED");
    expect(
      query.mock.calls.some(
        ([sql]) => sql.includes("role_assignments") && sql.includes("FOR SHARE"),
      ),
    ).toBe(true);
  });
  it("rejects a retry when no current corporate pilot fence exists", async () => {
    const record = {
      id: "command",
      workspaceId: "workspace",
      projectId: "project",
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      target: {},
      payload: {},
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
    };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue({
      ...record,
      targetHash: sha256({}),
      payloadHash: sha256({}),
      capability: { key: "test-executor.trigger-status", operation: "pipeline.trigger" },
      source: { sourceWorkItemId: "work", causalHumanPrincipalId: "human" },
    } as never);
    const guard = { assertEffectsAllowed: vi.fn() };
    const admission = createWorkerRetryAdmission(
      {} as never,
      { current: async () => undefined } as never,
      guard as never,
    );
    await expect(
      admission.persist(
        { queryRunner: { isTransactionActive: true }, query: async () => [] } as never,
        record as never,
      ),
    ).rejects.toThrow("PILOT_EFFECT_FENCED");
    expect(guard.assertEffectsAllowed).not.toHaveBeenCalled();
  });
  it("rejects an active quarantine inside the retry transaction", async () => {
    const record = {
      id: "command",
      workspaceId: "workspace",
      projectId: "project",
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      target: {},
      payload: {},
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
    };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue({
      ...record,
      targetHash: sha256({}),
      payloadHash: sha256({}),
    } as never);
    const fence = vi.fn();
    const admission = createWorkerRetryAdmission(
      {} as never,
      { current: fence } as never,
      { assertEffectsAllowed: vi.fn() } as never,
    );
    const query = vi.fn(async () => [{ active: 1 }]);
    await expect(
      admission.persist(
        { queryRunner: { isTransactionActive: true }, query } as never,
        record as never,
      ),
    ).rejects.toThrow("PILOT_RETRY_QUARANTINED");
    expect(fence).not.toHaveBeenCalled();
  });
  it("uses the causal human for the pilot fence and rejects unverified retry provenance", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      actor: { kind: "SERVICE" as const, principalId: "service", serviceKey: "gitlab" },
      capability: {
        key: "test-executor.trigger-status",
        operation: "pipeline.trigger",
        exactContractVersion: "1.0.0",
        logicalRole: "TEST_EXECUTION",
      },
      source: { sourceWorkItemId: "work", causalHumanPrincipalId: "human" },
    };
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => []);
    const repository = new PilotCommandAdmissionRepository({ query } as never);
    await expect(repository.load(command as never)).rejects.toThrow(
      "PILOT_RETRY_PROVENANCE_INVALID",
    );
    expect(query.mock.calls[0]?.[0]).toContain("AUTO_INFRA_RETRY");
    const guard = { assertEffectsAllowed: vi.fn(async () => undefined) };
    const admission = {
      commandId: command.id,
      payloadHash: command.payloadHash,
      targetHash: command.targetHash,
      expectedOnboardingVersion: 1,
      context: { principalId: "human" },
    };
    await new PilotCommandEffectGuard(
      guard as never,
      async () => admission as never,
    ).assertCommandAllowed(command as never);
    expect(guard.assertEffectsAllowed).toHaveBeenCalledWith(command, 1, admission.context);
  });
  it("loads a retry admission only after the stored attempt confirms both identities", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      actor: { kind: "SERVICE" as const, principalId: "service", serviceKey: "gitlab" },
      capability: {
        key: "test-executor.trigger-status",
        operation: "pipeline.trigger",
        exactContractVersion: "1.0.0",
        logicalRole: "TEST_EXECUTION",
      },
      source: { sourceWorkItemId: "work", causalHumanPrincipalId: "human" },
    };
    const ref = { id: "ref", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
    const query = vi.fn(async (sql: string, _parameters: readonly unknown[]) =>
      sql.includes("qa_automation_attempts")
        ? [{ valid: 1 }]
        : [
            {
              command_id: command.id,
              principal_id: "human",
              purpose: "BUSINESS",
              payload_hash: command.payloadHash,
              target_hash: command.targetHash,
              expected_onboarding_version: 1,
              deployment_ref: ref,
              cohort_ref: ref,
              fence_ref: ref,
            },
          ],
    );
    const repository = new PilotCommandAdmissionRepository({ query } as never);
    expect((await repository.load(command as never))?.context.principalId).toBe("human");
    expect(query.mock.calls[0]?.[1]).toEqual([
      command.workspaceId,
      command.projectId,
      command.id,
      "human",
      "service",
      command.effectIdempotencyKey,
      "work",
    ]);
  });
  it("does not replace the principal for ordinary human commands", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      actor: { kind: "HUMAN" as const, principalId: "human", issuer: "issuer", subject: "subject" },
      source: { sourceWorkItemId: "work", causalHumanPrincipalId: "other" },
    };
    const guard = { assertEffectsAllowed: vi.fn(async () => undefined) };
    const admission = {
      commandId: command.id,
      payloadHash: command.payloadHash,
      targetHash: command.targetHash,
      expectedOnboardingVersion: 1,
      context: { principalId: "other" },
    };
    await expect(
      new PilotCommandEffectGuard(
        guard as never,
        async () => admission as never,
      ).assertCommandAllowed(command as never),
    ).rejects.toThrow("PILOT_COMMAND_ADMISSION_CONFLICT");
    expect(guard.assertEffectsAllowed).not.toHaveBeenCalled();
  });
  it("uses the exact persisted service command inside the transaction", async () => {
    const record = {
      id: "command",
      workspaceId: "workspace",
      projectId: "project",
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      target: {},
      payload: {},
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
    };
    const command = {
      ...record,
      targetHash: sha256(record.target),
      payloadHash: sha256(record.payload),
    };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue(command as never);
    const persist = vi.fn(async () => undefined);
    const adapter = createRetryCommandAdmission({} as never, { persist, assertReplay: vi.fn() });
    await expect(adapter.persist({} as never, record as never)).rejects.toThrow(
      "PILOT_TRANSACTION_REQUIRED",
    );
    const manager = { queryRunner: { isTransactionActive: true } };
    await adapter.persist(manager as never, record as never);
    expect(persist).toHaveBeenCalledWith(manager, command);
  });
  it("rejects a service identity change before admission", async () => {
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue({
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "other", serviceKey: "gitlab" },
    } as never);
    const persist = vi.fn();
    const adapter = createRetryCommandAdmission({} as never, { persist, assertReplay: vi.fn() });
    await expect(
      adapter.persist(
        { queryRunner: { isTransactionActive: true } } as never,
        {
          id: "command",
          workspaceId: "workspace",
          projectId: "project",
          effectIdempotencyKey: "effect",
          actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
        } as never,
      ),
    ).rejects.toThrow("PILOT_RETRY_COMMAND_CONFLICT");
    expect(persist).not.toHaveBeenCalled();
  });
  it("rechecks the original admission on retry replay", async () => {
    const record = {
      id: "command",
      workspaceId: "workspace",
      projectId: "project",
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      target: {},
      payload: {},
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
    };
    const command = {
      ...record,
      targetHash: sha256(record.target),
      payloadHash: sha256(record.payload),
    };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue(command as never);
    const assertReplay = vi.fn(async () => undefined);
    const adapter = createRetryCommandAdmission({} as never, { persist: vi.fn(), assertReplay });
    const manager = { queryRunner: { isTransactionActive: true } };
    await adapter.assertReplay(manager as never, record as never);
    expect(assertReplay).toHaveBeenCalledWith(manager, command);
  });
  it("rejects replay when the requested command payload differs from the persisted command", async () => {
    const record = {
      id: "command",
      workspaceId: "workspace",
      projectId: "project",
      effectIdempotencyKey: "effect",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "gitlab" },
      target: {},
      payload: { revision: 2 },
      bindingRef: { id: "binding", version: 1 },
      profileRef: { id: "profile", version: 1 },
    };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue({
      ...record,
      targetHash: sha256({}),
      payloadHash: sha256({ revision: 1 }),
    } as never);
    const assertReplay = vi.fn();
    const adapter = createRetryCommandAdmission({} as never, { persist: vi.fn(), assertReplay });
    await expect(
      adapter.assertReplay(
        { queryRunner: { isTransactionActive: true } } as never,
        record as never,
      ),
    ).rejects.toThrow("PILOT_RETRY_COMMAND_CONFLICT");
    expect(assertReplay).not.toHaveBeenCalled();
  });
});
