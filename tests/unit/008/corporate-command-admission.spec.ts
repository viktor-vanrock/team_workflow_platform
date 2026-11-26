import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CorporateAdmissionUnitOfWork,
  createCorporateCommandAdmissionAuthority,
  createCorporateTransactionalCommandAdmission,
} from "../../../apps/api/src/extensions/corporate-command-admission.ts";
import {
  PilotCommandAdmissionRepository,
  TypeOrmUnitOfWork,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { PilotEffectGuard } from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";
import { designContractRegistry, sha256 } from "../../../packages/platform-contracts/src/index.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate command admission transaction", () => {
  it("rejects a GitLab launch without a pinned build before admission", async () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const body = { target: { type: "COMMIT", commitSha: "a".repeat(40) } };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const command = {
      ...base,
      commandType: "qa.automation.pipeline.trigger",
      payload: { testSessionId: "session", targetSnapshotHash: snapshot.snapshotHash },
    };
    const guard = { assertEffectsAllowed: vi.fn() };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi.fn().mockResolvedValue([{ target_snapshot: snapshot }]),
    };
    const admission = createCorporateTransactionalCommandAdmission({} as never, { guard } as never);
    await expect(admission.persist(manager as never, command as never)).rejects.toThrow(
      "CORPORATE_GITLAB_BUILD_REF_REQUIRED",
    );
    expect(guard.assertEffectsAllowed).not.toHaveBeenCalled();
  });

  it("rejects a changed snapshot even when it contains a build", async () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const command = {
      ...base,
      commandType: "qa.automation.pipeline.trigger",
      payload: { testSessionId: "session", targetSnapshotHash: sha256("original") },
    };
    const body = { target: { type: "BUILD", buildRef: "pipeline:101" } };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi
        .fn()
        .mockResolvedValue([{ target_snapshot: { ...body, snapshotHash: sha256(body) } }]),
    };
    const admission = createCorporateTransactionalCommandAdmission(
      {} as never,
      { guard: {} } as never,
    );
    await expect(admission.persist(manager as never, command as never)).rejects.toThrow(
      "CORPORATE_GITLAB_TARGET_SNAPSHOT_STALE",
    );
  });

  it("rejects a GitLab launch without a trusted published parameter schema", async () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const body = {
      target: { type: "BUILD", buildRef: "pipeline:101" },
      suite: { acceptedParameters: { BUILD_REF: "pipeline:101" } },
    };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const command = {
      ...base,
      commandType: "qa.automation.pipeline.trigger",
      payload: { testSessionId: "session", targetSnapshotHash: snapshot.snapshotHash },
    };
    const context = { principalId: command.actor.principalId };
    const guard = { assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }) };
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ target_snapshot: snapshot }])
      .mockResolvedValueOnce([{ current_version: 3, current_operational_state: "ACTIVE" }]);
    const insert = vi
      .spyOn(PilotCommandAdmissionRepository.prototype, "insert")
      .mockResolvedValue();
    const admission = createCorporateTransactionalCommandAdmission(
      {} as never,
      { context: vi.fn().mockResolvedValue(context), guard } as never,
    );
    await expect(
      admission.persist(
        { queryRunner: { isTransactionActive: true }, query } as never,
        command as never,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_SUITE_CONFIGURATION_INVALID");
    expect(insert).not.toHaveBeenCalled();
  });

  it("admits the build only with the exact published Suite and bundled v1 schema", async () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const id = "urn:awp:schemas:qa:automation-parameters:build-ref:v1";
    const parameterSchemaRef = { id, version: 1, contentHash: designContractRegistry.digest(id) };
    const content = { parameterSchemaRef };
    const acceptedParameters = { BUILD_REF: "pipeline:101" };
    const body = {
      target: { type: "BUILD", buildRef: "pipeline:101" },
      suite: {
        suiteKey: "suite-key",
        suiteBindingRef: { id: "suite", version: 1 },
        suiteBindingHash: sha256(content),
        parameterSchemaRef,
        acceptedParameters,
        parametersHash: sha256(acceptedParameters),
      },
    };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const command = {
      ...base,
      commandType: "qa.automation.pipeline.trigger",
      payload: { testSessionId: "session", targetSnapshotHash: snapshot.snapshotHash },
    };
    const context = { principalId: command.actor.principalId };
    const guard = { assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }) };
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ target_snapshot: snapshot }])
      .mockResolvedValueOnce([{ content, content_hash: sha256(content) }])
      .mockResolvedValueOnce([{ current_version: 3, current_operational_state: "ACTIVE" }]);
    const insert = vi
      .spyOn(PilotCommandAdmissionRepository.prototype, "insert")
      .mockResolvedValue();
    const admission = createCorporateTransactionalCommandAdmission(
      {} as never,
      { context: vi.fn().mockResolvedValue(context), guard } as never,
    );
    await admission.persist(
      { queryRunner: { isTransactionActive: true }, query } as never,
      command as never,
    );
    expect(insert).toHaveBeenCalledOnce();
  });

  it("rejects a build parameter that differs from the selected build", async () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const body = {
      target: { type: "BUILD", buildRef: "pipeline:101" },
      suite: { acceptedParameters: { BUILD_REF: "pipeline:102" } },
    };
    const snapshot = { ...body, snapshotHash: sha256(body) };
    const command = {
      ...base,
      commandType: "qa.automation.pipeline.trigger",
      payload: { testSessionId: "session", targetSnapshotHash: snapshot.snapshotHash },
    };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi.fn().mockResolvedValue([{ target_snapshot: snapshot }]),
    };
    const admission = createCorporateTransactionalCommandAdmission(
      {} as never,
      { guard: {} } as never,
    );
    await expect(admission.persist(manager as never, command as never)).rejects.toThrow(
      "CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED",
    );
  });
  it("requires a transaction and persists the original admission with the command", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const context = { principalId: command.actor.principalId };
    const authority = {
      context: vi.fn().mockResolvedValue(context),
      guard: {
        assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }),
      },
    };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi
        .fn()
        .mockResolvedValue([{ current_version: 3, current_operational_state: "ACTIVE" }]),
    };
    const insert = vi
      .spyOn(PilotCommandAdmissionRepository.prototype, "insert")
      .mockResolvedValue();
    const admission = createCorporateTransactionalCommandAdmission({} as never, authority as never);
    await expect(admission.persist({} as never, command)).rejects.toThrow(
      "PILOT_TRANSACTION_REQUIRED",
    );
    await admission.persist(manager as never, command);
    expect(insert).toHaveBeenCalledWith(
      manager,
      command,
      expect.objectContaining({
        commandId: command.id,
        expectedOnboardingVersion: 3,
        context,
      }),
    );
    expect(authority.guard.assertEffectsAllowed).toHaveBeenCalledTimes(3);
  });

  it("rejects replay without the original admission", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    vi.spyOn(PilotCommandAdmissionRepository.prototype, "load").mockResolvedValue(undefined);
    const guard = { assertEffectsAllowed: vi.fn() };
    const admission = createCorporateTransactionalCommandAdmission({} as never, { guard } as never);
    await expect(admission.assertReplay({} as never, command)).rejects.toThrow(
      "PILOT_COMMAND_ADMISSION_REQUIRED",
    );
    expect(guard.assertEffectsAllowed).not.toHaveBeenCalled();
  });

  it("rejects transactional admission if onboarding changed before the lock", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const context = { principalId: command.actor.principalId };
    const guard = { assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }) };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi
        .fn()
        .mockResolvedValue([{ current_version: 4, current_operational_state: "ACTIVE" }]),
    };
    const insert = vi
      .spyOn(PilotCommandAdmissionRepository.prototype, "insert")
      .mockResolvedValue();
    const admission = createCorporateTransactionalCommandAdmission(
      {} as never,
      {
        context: vi.fn().mockResolvedValue(context),
        guard,
      } as never,
    );
    await expect(admission.persist(manager as never, command)).rejects.toThrow(
      "PILOT_COMMAND_ONBOARDING_CHANGED",
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("rechecks the original admission when an automation launch is replayed", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const context = { principalId: command.actor.principalId };
    const load = vi.spyOn(PilotCommandAdmissionRepository.prototype, "load").mockResolvedValue({
      commandId: command.id,
      payloadHash: command.payloadHash,
      targetHash: command.targetHash,
      expectedOnboardingVersion: 3,
      context: context as never,
    });
    const guard = { assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }) };
    const admission = createCorporateTransactionalCommandAdmission({} as never, { guard } as never);
    const manager = {};
    await admission.assertReplay(manager as never, command);
    expect(load).toHaveBeenCalledWith(command, manager);
    expect(guard.assertEffectsAllowed).toHaveBeenCalledWith(command, 3, context);
  });
  it("persists the command and original fence admission together and rechecks the guard", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const ref = { id: "ref", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
    const context = {
      principalId: command.actor.principalId,
      purpose: "BUSINESS" as const,
      deploymentRef: ref,
      cohortRef: ref,
      fenceRef: ref,
    };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi
        .fn()
        .mockResolvedValue([{ current_version: 3, current_operational_state: "ACTIVE" }]),
    };
    const transaction = vi.fn(
      async (_isolation: string, callback: (manager: object) => Promise<void>) =>
        await callback(manager),
    );
    const commit = vi.spyOn(TypeOrmUnitOfWork.prototype, "commit").mockResolvedValue();
    const insert = vi
      .spyOn(PilotCommandAdmissionRepository.prototype, "insert")
      .mockResolvedValue();
    const assertEffectsAllowed = vi.fn().mockResolvedValue({ onboardingVersion: 3 });
    const authority = {
      context: vi.fn().mockResolvedValue(context),
      guard: { assertEffectsAllowed },
    };
    const unit = new CorporateAdmissionUnitOfWork({ transaction } as never, authority as never);
    await unit.commit({ command } as never);
    expect(commit).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      manager,
      command,
      expect.objectContaining({
        commandId: command.id,
        payloadHash: command.payloadHash,
        targetHash: command.targetHash,
        expectedOnboardingVersion: 3,
        context,
      }),
    );
    expect(assertEffectsAllowed).toHaveBeenCalledTimes(3);
  });

  it("rejects an admission for another principal before creating the command", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const transaction = vi.fn();
    const authority = {
      context: vi.fn().mockResolvedValue({ principalId: "other" }),
      guard: { assertEffectsAllowed: vi.fn() },
    };
    const unit = new CorporateAdmissionUnitOfWork({ transaction } as never, authority as never);
    await expect(unit.commit({ command } as never)).rejects.toThrow(
      "PILOT_COMMAND_ADMISSION_CONFLICT",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not create a command when the onboarding version changes before commit", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const context = { principalId: command.actor.principalId };
    const manager = {
      queryRunner: { isTransactionActive: true },
      query: vi
        .fn()
        .mockResolvedValue([{ current_version: 4, current_operational_state: "ACTIVE" }]),
    };
    const transaction = vi.fn(
      async (_isolation: string, callback: (manager: object) => Promise<void>) =>
        await callback(manager),
    );
    const commit = vi.spyOn(TypeOrmUnitOfWork.prototype, "commit").mockResolvedValue();
    const authority = {
      context: vi.fn().mockResolvedValue(context),
      guard: { assertEffectsAllowed: vi.fn().mockResolvedValue({ onboardingVersion: 3 }) },
    };
    const unit = new CorporateAdmissionUnitOfWork({ transaction } as never, authority as never);
    await expect(unit.commit({ command } as never)).rejects.toThrow(
      "PILOT_COMMAND_ONBOARDING_CHANGED",
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it("requires the original persisted admission when replaying a command", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    vi.spyOn(PilotCommandAdmissionRepository.prototype, "load").mockResolvedValue(undefined);
    const guard = { assertEffectsAllowed: vi.fn() };
    const unit = new CorporateAdmissionUnitOfWork({} as never, { guard } as never);
    await expect(unit.assertReplay(command)).rejects.toThrow("PILOT_COMMAND_ADMISSION_REQUIRED");
    expect(guard.assertEffectsAllowed).not.toHaveBeenCalled();
  });

  it("uses the fence's active worker registration, never the API instance, and fails closed without it", async () => {
    const ref = { id: "ref", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
    const fence = {
      mode: "COHORT_WRITES",
      environment: "NON_PROD",
      runtimeInstanceId: "worker-instance",
      deploymentRef: ref,
      cohortRef: ref,
      fenceRef: ref,
    };
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => [
      { instance_id: "worker-instance" },
    ]);
    const source = { isInitialized: true, query };
    const startup = {
      instanceId: "api-instance",
      assertReady: vi.fn(),
      policy: { deploymentId: "deployment", version: 1, imageDigest: ref.contentHash },
    };
    const fences = { current: vi.fn().mockResolvedValue(fence), authorize: vi.fn() };
    const check = vi.spyOn(PilotEffectGuard.prototype, "assertEffectsAllowed").mockResolvedValue({
      workspaceId: "workspace",
      projectId: "project",
      operationalState: "ACTIVE",
      onboardingVersion: 1,
    });
    const authority = createCorporateCommandAdmissionAuthority(
      source as never,
      fences as never,
      startup as never,
    );
    const context = await authority.context(
      { workspaceId: "workspace", projectId: "project" },
      "human",
    );
    expect(context.principalId).toBe("human");
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("worker-instance");
    expect(check).toHaveBeenCalled();
    query.mockResolvedValue([]);
    await expect(
      authority.guard.assertEffectsAllowed(
        { workspaceId: "workspace", projectId: "project" },
        1,
        context,
      ),
    ).rejects.toThrow("PILOT_WORKER_FENCE_UNAVAILABLE");
  });
});
