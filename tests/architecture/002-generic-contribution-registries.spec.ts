import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  type ConfirmedOperationalEffect,
  type ExternalCommandLifecycleContribution,
  externalCommandLifecyclePhases,
  type OperationalConfirmationHook,
  type PackLifecycleDelta,
  type ScopedExternalCommandContext,
} from "../../packages/platform-contracts/src/index.ts";
import {
  ConfirmOperationalEffect,
  OperationalConfirmationHookRegistry,
  type PlatformAction,
  PlatformActionExecutor,
  PlatformActionHandlerRegistry,
  type PlatformActionPort,
} from "../../packages/platform-core/src/index.ts";
import { TypeOrmExternalCommandLifecycleUnitOfWork } from "../../packages/platform-persistence-typeorm/src/index.ts";

const root = resolve(import.meta.dirname, "../..");

const effect: ConfirmedOperationalEffect = Object.freeze({
  workspaceId: "workspace-alpha",
  projectId: "project-alpha",
  commandId: "command-a",
  effectIdempotencyKey: "effect-a",
  capabilityKey: "operational-work-item",
  capabilityVersion: "1.0.0",
  operation: "request.create",
  result: { externalId: "request-a" },
  source: { intakeDraftId: "draft-a" },
  bindingRef: { id: "binding-a", version: 1 },
  profileRefs: [{ id: "profile-a", version: 1 }],
  correlationId: "correlation-a",
  causationId: "causation-a",
});

const lifecycleContext: ScopedExternalCommandContext = Object.freeze({
  workspaceId: "workspace-alpha",
  projectId: "project-alpha",
  commandId: "command-a",
  commandType: "EXTERNAL_WRITE",
  capabilityKey: "operational-work-item",
  capabilityVersion: "1.0.0",
  operation: "request.transition",
  source: { sourceWorkItemId: "work-item-a" },
  bindingRef: { id: "binding-a", version: 1 },
  profileRefs: [{ id: "profile-a", version: 1 }],
  effectIdempotencyKey: "effect-a",
  correlationId: "correlation-a",
  causationId: "causation-a",
  approvalId: "approval-a",
  commandResourceVersion: 3,
});

function confirmationHook(key: string, order: number, matches = true): OperationalConfirmationHook {
  return {
    key,
    order,
    matches: () => matches,
    apply: async (_input, transaction) => ({
      idempotencyKey: transaction.idempotencyKey,
      replayed: false,
    }),
  };
}

describe("QA-agnostic generic contribution registries", () => {
  it("selects confirmation hooks deterministically and preserves the empty 001 default", async () => {
    const first = confirmationHook("pack.first", 10);
    const second = confirmationHook("pack.second", 20);
    const ignored = confirmationHook("pack.ignored", 0, false);
    const registry = new OperationalConfirmationHookRegistry([second, ignored, first]);
    expect(registry.matching(effect).map(({ key }) => key)).toEqual(["pack.first", "pack.second"]);
    expect(() => new OperationalConfirmationHookRegistry([first, first])).toThrow(
      "CONFIRMATION_HOOK_COLLISION:pack.first",
    );

    const confirmEffect = vi.fn(
      async (_input: ConfirmedOperationalEffect, hooks: readonly OperationalConfirmationHook[]) => {
        expect(hooks).toEqual([]);
        return [];
      },
    );
    const legacyDefault = new ConfirmOperationalEffect(
      { confirmEffect },
      new OperationalConfirmationHookRegistry([]),
    );
    await expect(legacyDefault.confirm(effect)).resolves.toEqual([]);
    expect(confirmEffect).toHaveBeenCalledOnce();
  });

  it("dispatches each lifecycle contribution once per phase before Core transition with sorted locks", async () => {
    const sequence: string[] = [];
    const lockKeys: string[] = [];
    const manager = {
      query: vi.fn(async (_sql: string, parameters: readonly unknown[]) => {
        lockKeys.push(String(parameters[0]));
        return [];
      }),
    };
    const source = {
      transaction: vi.fn(
        async (
          _isolation: string,
          work: (transactionManager: typeof manager) => Promise<unknown>,
        ) => await work(manager),
      ),
    } as unknown as ConstructorParameters<typeof TypeOrmExternalCommandLifecycleUnitOfWork>[0];
    const contribution = (key: string, order: number) => {
      const apply = vi.fn(async (phase, _input, transaction): Promise<PackLifecycleDelta> => {
        sequence.push(`apply:${key}:${phase}`);
        return { idempotencyKey: transaction.idempotencyKey, replayed: false };
      });
      const value: ExternalCommandLifecycleContribution = {
        key,
        order,
        matches: () => true,
        apply,
      };
      return { value, apply };
    };
    const first = contribution("pack.first", 10);
    const second = contribution("pack.second", 20);
    const unitOfWork = new TypeOrmExternalCommandLifecycleUnitOfWork(
      source,
      [second.value, first.value],
      {
        applyDelta: async (_manager, phase, _input, selected) => {
          sequence.push(`delta:${selected.key}:${phase}`);
        },
      },
    );

    const outcome = await unitOfWork.execute("APPROVAL_RELEASED", lifecycleContext, async () => {
      sequence.push("core:HELD_TO_READY");
      return "READY";
    });
    expect(outcome.result).toBe("READY");
    expect(outcome.deltas.map(({ idempotencyKey }) => idempotencyKey)).toEqual([
      "command-a:APPROVAL_RELEASED:pack.first",
      "command-a:APPROVAL_RELEASED:pack.second",
    ]);
    expect(sequence).toEqual([
      "apply:pack.first:APPROVAL_RELEASED",
      "delta:pack.first:APPROVAL_RELEASED",
      "apply:pack.second:APPROVAL_RELEASED",
      "delta:pack.second:APPROVAL_RELEASED",
      "core:HELD_TO_READY",
    ]);
    expect(lockKeys).toEqual([...lockKeys].sort());
    expect(first.apply).toHaveBeenCalledOnce();
    expect(second.apply).toHaveBeenCalledOnce();
    expect(externalCommandLifecyclePhases).toEqual([
      "APPROVAL_REJECTED",
      "APPROVAL_RELEASED",
      "EFFECT_INVOCATION_STARTED",
      "TERMINAL_FAILED",
    ]);
    expect(
      () => new TypeOrmExternalCommandLifecycleUnitOfWork(source, [first.value, first.value]),
    ).toThrow("EXTERNAL_COMMAND_LIFECYCLE_COLLISION:pack.first");
  });

  it("claims a platform action by CAS before executing exactly one matching handler", async () => {
    let action: PlatformAction<{ kind: string }, { published: boolean }> = {
      id: "action-a",
      kind: "policy.action",
      candidate: { kind: "candidate" },
      candidateHash: "sha256:candidate",
      initiatorId: "executor",
      state: "PENDING_APPROVAL",
      rowVersion: 1,
    };
    const claim = vi.fn(async (_id: string, expectedVersion: number) => {
      expect(expectedVersion).toBe(1);
      action = { ...action, state: "EXECUTING", rowVersion: 2 };
      return action;
    });
    const port: PlatformActionPort<{ kind: string }, { published: boolean }> = {
      save: vi.fn(async () => undefined),
      get: vi.fn(async () => action),
      claim,
      complete: vi.fn(async (_id, expectedVersion, result) => {
        expect(expectedVersion).toBe(2);
        action = { ...action, state: "COMPLETED", result, rowVersion: 3 };
        return action;
      }),
      fail: vi.fn(async () => action),
    };
    const execute = vi.fn(async () => {
      expect(action.state).toBe("EXECUTING");
      return { published: true };
    });
    const handler = {
      key: "pack.policy-action",
      matches: (candidate: PlatformAction) => candidate.kind === "policy.action",
      execute,
    };
    const registry = new PlatformActionHandlerRegistry([handler]);
    const executor = new PlatformActionExecutor(port, registry);
    await expect(
      executor.execute("action-a", 1, {
        workspaceId: "workspace-alpha",
        projectId: "project-alpha",
        approvalId: "approval-a",
        approverId: "lead",
        authorizationBasisHash: "sha256:basis",
      }),
    ).resolves.toMatchObject({ state: "COMPLETED", rowVersion: 3, result: { published: true } });
    expect(claim).toHaveBeenCalledBefore(execute);
    expect(execute).toHaveBeenCalledOnce();
    expect(() => new PlatformActionHandlerRegistry([handler, handler])).toThrow(
      "PLATFORM_ACTION_HANDLER_COLLISION:pack.policy-action",
    );
  });

  it("contains no QA action or command switch in generic implementation paths", async () => {
    const paths = [
      "packages/platform-core/src/work-management/confirm-operational-effect.ts",
      "packages/platform-persistence-typeorm/src/external-command-lifecycle-unit-of-work.ts",
      "packages/platform-core/src/approval/platform-action-executor.ts",
    ];
    const source = (
      await Promise.all(paths.map(async (path) => await readFile(resolve(root, path), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/qa\.|QA_REQUEST|TEST_SESSION|FINDING|VERDICT/u);
    expect(source).not.toMatch(/switch\s*\([^)]*(?:action|operation|command)/iu);
  });
});
