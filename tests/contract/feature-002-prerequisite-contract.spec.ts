import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "../..");

function source(relativePath: string): string {
  const path = resolve(workspace, relativePath);
  expect(existsSync(path), `${relativePath} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function expectPublicExports(indexPath: string, exports: readonly string[]): void {
  const index = source(indexPath);
  for (const publicExport of exports)
    expect(index, `${publicExport} must be public`).toContain(publicExport);
}

describe("Feature 002 prerequisite compatibility contract", () => {
  it("keeps the stable Feature 001 Command, Approval, Artifact, Event and Confirmation primitives public", async () => {
    const core = await import("../../packages/platform-core/src/index.ts");
    const contracts = await import("../../packages/platform-contracts/src/index.ts");

    expect(core.CommandGateway).toBeTypeOf("function");
    expect(core.createExactApproval).toBeTypeOf("function");
    expect(core.ArtifactService).toBeTypeOf("function");
    expect(core.validateEventEnvelope).toBeTypeOf("function");
    expect(core.ConfirmOperationalCreate).toBeTypeOf("function");
    expect(contracts.OfflineSchemaRegistry).toBeTypeOf("function");
    expectPublicExports("packages/platform-contracts/src/index.ts", [
      "./extensions/confirmation-hook.ts",
    ]);
  });

  it("defines one generic multi-effect confirmation contract instead of a create-only hook", () => {
    const contract = source("packages/platform-contracts/src/extensions/confirmation-hook.ts");
    const useCase = source(
      "packages/platform-core/src/work-management/confirm-operational-effect.ts",
    );
    const unitOfWork = source(
      "packages/platform-persistence-typeorm/src/confirmation-unit-of-work.ts",
    );

    for (const token of [
      "ConfirmedOperationalEffect",
      "OperationalConfirmationHook",
      "PackOwnedTransaction",
      "PackConfirmationDelta",
      "matches",
      "apply",
    ]) {
      expect(contract, `confirmation contract must expose ${token}`).toContain(token);
    }
    expect(useCase).toContain("ConfirmOperationalEffect");
    expect(useCase).not.toMatch(/if\s*\([^)]*qa\./iu);
    expect(unitOfWork).toContain("OperationalConfirmationHook");
    expect(unitOfWork).toContain("PackConfirmationDelta");
  });

  it("defines a closed, idempotent external-command lifecycle contribution before outbox visibility", () => {
    const contract = source(
      "packages/platform-contracts/src/extensions/external-command-lifecycle-hook.ts",
    );
    const unitOfWork = source(
      "packages/platform-persistence-typeorm/src/external-command-lifecycle-unit-of-work.ts",
    );

    for (const phase of [
      "APPROVAL_REJECTED",
      "APPROVAL_RELEASED",
      "EFFECT_INVOCATION_STARTED",
      "TERMINAL_FAILED",
    ]) {
      expect(contract, `lifecycle phase ${phase} must be closed and public`).toContain(phase);
    }
    for (const token of [
      "ExternalCommandLifecycleContribution",
      "ScopedExternalCommandContext",
      "PackLifecycleDelta",
      "matches",
      "apply",
    ]) {
      expect(contract, `lifecycle contract must expose ${token}`).toContain(token);
    }
    expect(unitOfWork).toMatch(/commandId[\s\S]*phase/iu);
    expect(unitOfWork).toMatch(/idempoten|alreadyApplied|phaseLedger/iu);
    expect(unitOfWork.indexOf("APPROVAL_RELEASED")).toBeLessThan(unitOfWork.indexOf("READY"));
    expect(unitOfWork).not.toMatch(/if\s*\([^)]*qa\./iu);
  });

  it("routes exact platform actions through a generic handler registry with CAS", () => {
    const port = source("packages/platform-core/src/approval/platform-action-port.ts");
    const executor = source("packages/platform-core/src/approval/platform-action-executor.ts");

    for (const token of [
      "PlatformActionHandler",
      "PlatformActionHandlerRegistry",
      "matches",
      "execute",
    ]) {
      expect(executor, `platform action executor must expose ${token}`).toContain(token);
    }
    expect(port).toContain("expectedVersion");
    expect(executor).toMatch(/expectedVersion|rowVersion/iu);
    expect(executor).not.toMatch(/BINDING_PUBLICATION[\s\S]*(?:case|if\s*\()/iu);
    expectPublicExports("packages/platform-core/src/index.ts", [
      "./approval/platform-action-executor.ts",
    ]);
  });

  it("publishes scoped Project Registry, binding health and operational projection query ports", () => {
    const projectQueries = source("packages/platform-core/src/work-management/query-ports.ts");
    const integrationQueries = source(
      "packages/platform-core/src/integration-registry/query-ports.ts",
    );
    const workRepository = source(
      "packages/platform-persistence-typeorm/src/work-management.repository.ts",
    );
    const integrationRepository = source(
      "packages/platform-persistence-typeorm/src/integration-configuration.repository.ts",
    );

    for (const token of [
      "ProjectRegistryQueryPort",
      "OperationalProjectionQueryPort",
      "workspaceId",
      "projectId",
    ])
      expect(projectQueries).toContain(token);
    for (const token of [
      "IntegrationConfigurationQueryPort",
      "binding",
      "profile",
      "mapping",
      "health",
      "workspaceId",
      "projectId",
    ])
      expect(integrationQueries).toContain(token);
    expect(workRepository).toContain("operationalProjection");
    expect(integrationRepository).toContain("bindingHealth");
    expectPublicExports("packages/platform-core/src/index.ts", [
      "./work-management/query-ports.ts",
      "./integration-registry/query-ports.ts",
    ]);
  });

  it("provides generic permission and artifact-authorization contribution surfaces", () => {
    const artifact = source("packages/platform-core/src/artifacts/artifact-authorization-port.ts");
    const authorization = source(
      "packages/platform-runtime-nest/src/auth/authorization-contributions.ts",
    );
    const controller = source("packages/platform-runtime-nest/src/http/artifacts.controller.ts");

    for (const token of [
      "ArtifactAuthorizationContribution",
      "ArtifactAuthorizationContributionRegistry",
      "matches",
      "authorize",
    ])
      expect(artifact).toContain(token);
    for (const token of [
      "AuthorizationContribution",
      "AuthorizationContributionRegistry",
      "matches",
      "authorize",
    ])
      expect(authorization).toContain(token);
    expect(controller).toContain("ArtifactAuthorizationContributionRegistry");
    expect(controller).not.toMatch(/if\s*\([^)]*qa\./iu);
  });

  it("forbids the external operational intake path from turning submitDraft directly into a WorkItem", () => {
    const handlers = source("packages/runtime-composition/src/extensions/generic-handlers.ts");
    expect(handlers).not.toMatch(
      /submitDraft\s*\([^)]*\)[\s\S]{0,300}(?:new\s+WorkItem|insertWorkItem|createWorkItem)/iu,
    );
    expect(handlers).toContain("ConfirmOperationalEffect");
    expect(handlers).toContain("externalCommandLifecycle");
  });
});
