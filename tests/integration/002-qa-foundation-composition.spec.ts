import { describe, expect, it, vi } from "vitest";

import {
  QaAdjudicativeMutationInvalidatorRegistry,
  qaEntities,
  qaMigrationContributions,
} from "../../packages/competency-qa/src/node.ts";
import type { RuntimeEnvironment } from "../../packages/runtime-composition/src/config/environment.ts";
import { localExtensionCandidates } from "../../packages/runtime-composition/src/extensions/composition.ts";
import { localMigrationRegistry } from "../../packages/runtime-composition/src/migrations/composition.ts";
import { localEntities } from "../../packages/runtime-composition/src/persistence/entity-composition.ts";
import {
  qaLocalCompetencyManifestVersions,
  qaLocalComposition,
  RuntimeQaBindingHealthAdapter,
  RuntimeQaOperationalProjectionAdapter,
  RuntimeQaProjectRegistryAdapter,
  selectRuntimeComposition,
} from "../../packages/runtime-composition/src/qa/composition.ts";

const context = Object.freeze({
  actor: {
    kind: "HUMAN" as const,
    principalId: "executor",
    issuer: "fake-idp",
    subject: "executor",
  },
  scope: {
    kind: "PROJECT" as const,
    workspaceId: "workspace-alpha",
    projectId: "project-alpha",
  },
  correlationId: "correlation",
  causationId: "causation",
});

const environment: RuntimeEnvironment = Object.freeze({
  profile: "local",
  environmentScope: "LOCAL",
  environmentInput: { scope: "LOCAL", source: "LEGACY", raw: "local" } as const,
  composition: "foundation",
  databaseUrl: "postgresql://local",
  mockHubUrl: "http://mock-hub",
  identityIssuer: "https://fake-idp",
  identityAudience: "awp",
  externalNetworkMode: "deny",
});

describe("QA foundation composition", () => {
  it("keeps default foundation arrays QA-free and installs the explicit US1 QA slice only in qa-local", () => {
    expect(
      localExtensionCandidates.flatMap(({ manifest }) =>
        manifest.kind === "CompetencyPack" ? [manifest.metadata.key] : [],
      ),
    ).not.toContain("competency-qa");
    expect(
      qaLocalComposition.extensionCandidates.slice(0, localExtensionCandidates.length),
    ).toEqual(localExtensionCandidates);
    expect(qaLocalComposition.extensionCandidates.length).toBeGreaterThanOrEqual(
      localExtensionCandidates.length + 2,
    );
    expect(qaLocalCompetencyManifestVersions.slice(0, 2)).toEqual(["1.0.0", "1.1.0"]);
    expect(new Set(qaLocalCompetencyManifestVersions).size).toBe(
      qaLocalCompetencyManifestVersions.length,
    );
    expect(qaLocalComposition.extensionCandidates.at(-1)?.manifest).toMatchObject({
      metadata: { key: "competency-qa", version: qaLocalCompetencyManifestVersions.at(-1) },
    });
    expect(
      qaLocalComposition.extensionCandidates.some(
        ({ manifest }) =>
          manifest.kind === "CapabilityContract" && manifest.key === "operational-work-item",
      ),
    ).toBe(true);
    expect(qaLocalComposition.migrationRegistry.slice(0, localMigrationRegistry.length)).toEqual(
      localMigrationRegistry,
    );
    const qaSlice = qaLocalComposition.migrationRegistry.slice(localMigrationRegistry.length);
    expect(qaSlice).toEqual(qaMigrationContributions);
    expect(qaSlice.every(({ owner, order }) => owner === "pack:qa" && order >= 2000)).toBe(true);
    expect(qaSlice.map(({ order }) => order)).toEqual(
      [...qaSlice.map(({ order }) => order)].sort((left, right) => left - right),
    );
    expect(qaLocalComposition.entities.slice(0, localEntities.length)).toEqual(localEntities);
    expect(qaLocalComposition.entities).toHaveLength(localEntities.length + qaEntities.length);
    expect(qaLocalComposition.handlerContributions).toEqual({
      confirmationHooks: [],
      externalCommandLifecycle: [],
      platformActionHandlers: [],
    });
  });

  it("defaults to foundation and confines qa-local to denied-network local/test profiles", () => {
    expect(selectRuntimeComposition({}, environment)).toBe("foundation");
    expect(selectRuntimeComposition({ AWP_COMPOSITION: "qa-local" }, environment)).toBe("qa-local");
    expect(() =>
      selectRuntimeComposition(
        { AWP_COMPOSITION: "qa-local" },
        { ...environment, profile: "non-local" },
      ),
    ).toThrow("QA_LOCAL_COMPOSITION_PROFILE_FORBIDDEN");
    expect(() =>
      selectRuntimeComposition(
        { AWP_COMPOSITION: "qa-local" },
        { ...environment, externalNetworkMode: "allowlisted" },
      ),
    ).toThrow("QA_LOCAL_COMPOSITION_NETWORK_FORBIDDEN");
    expect(() =>
      selectRuntimeComposition({ AWP_COMPOSITION: "qa-local" }, { ...environment, mockHubUrl: "" }),
    ).toThrow("QA_LOCAL_COMPOSITION_MOCK_HUB_REQUIRED");
  });

  it("bridges generic scoped query ports without exposing repositories", async () => {
    const projectRegistryStatus = vi.fn(async () => ({
      workspaceId: "workspace-alpha",
      projectId: "project-alpha",
      lifecycleState: "ACTIVE" as const,
      verificationState: "CURRENT" as const,
      verificationRef: { id: "project-alpha", version: 1 },
    }));
    const operationalProjection = vi.fn(async () => ({
      workspaceId: "workspace-alpha",
      projectId: "project-alpha",
      workItemId: "work-item",
      workTypeKey: "qa.validation",
      workTypeVersion: "1.0.0",
      normalizedStatus: "NEW" as const,
      rawExternalState: "OPEN",
      resourceVersion: 1,
    }));
    const bindingHealth = vi.fn(async () => ({
      workspaceId: "workspace-alpha",
      projectId: "project-alpha",
      bindingRef: { id: "binding", version: 1 },
      bindingState: "PUBLISHED" as const,
      health: "CURRENT" as const,
      profiles: [],
      resourceVersion: 1,
    }));
    const projectAdapter = new RuntimeQaProjectRegistryAdapter({ projectRegistryStatus });
    const projectionAdapter = new RuntimeQaOperationalProjectionAdapter({ operationalProjection });
    const bindingAdapter = new RuntimeQaBindingHealthAdapter({
      bindingHealth,
    } as never);
    await expect(projectAdapter.current(context)).resolves.toMatchObject({
      projectId: "project-alpha",
    });
    await expect(projectionAdapter.current(context, "work-item")).resolves.toMatchObject({
      workItemId: "work-item",
    });
    await expect(
      bindingAdapter.current(context, { id: "binding", version: 1 }),
    ).resolves.toMatchObject({ health: "CURRENT" });
    expect(projectRegistryStatus).toHaveBeenCalledWith("workspace-alpha", "project-alpha");
    expect(operationalProjection).toHaveBeenCalledWith(
      "workspace-alpha",
      "project-alpha",
      "work-item",
    );
    expect(bindingHealth).toHaveBeenCalledWith("workspace-alpha", "project-alpha", {
      id: "binding",
      version: 1,
    });
  });

  it("uses a no-op invalidator by default and deterministic collision-checked contributions", async () => {
    const empty = new QaAdjudicativeMutationInvalidatorRegistry();
    await expect(
      empty.invalidatePending(context, "work-item", "AGGREGATE_CHANGED"),
    ).resolves.toBeUndefined();
    const first = { key: "first", order: 10, invalidatePending: vi.fn(async () => undefined) };
    const second = { key: "second", order: 20, invalidatePending: vi.fn(async () => undefined) };
    const registry = new QaAdjudicativeMutationInvalidatorRegistry([second, first]);
    await registry.invalidatePending(context, "work-item", "AGGREGATE_CHANGED");
    expect(first.invalidatePending).toHaveBeenCalledBefore(second.invalidatePending);
    expect(() => new QaAdjudicativeMutationInvalidatorRegistry([first, first])).toThrow(
      "QA_MUTATION_INVALIDATOR_COLLISION:first",
    );
  });
});
