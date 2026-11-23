import { describe, expect, it } from "vitest";

import {
  designContractRegistry,
  type SchemaReference,
} from "../../../packages/platform-contracts/src/index.ts";
import {
  InMemoryWorkManagementRepository,
  WorkManagementService,
  type WorkspaceContext,
  type WorkTypeDefinitionPin,
} from "../../../packages/platform-core/src/index.ts";
import { fixtureJson } from "../../support/fixture-value.ts";

type QaPackExports = Readonly<{
  qaCompetencyManifest?: Readonly<Record<string, unknown>>;
  qaValidationWorkTypeDefinition?: Readonly<Record<string, unknown>>;
  qaRequestKinds?: readonly string[];
  qaSessionModes?: readonly string[];
}>;

const clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const ids = {
  next: (() => {
    let value = 0;
    return () => `qa-id-${(value += 1)}`;
  })(),
};

function context(workspaceId: string, projectId: string): WorkspaceContext {
  return Object.freeze({
    actor: { kind: "HUMAN", principalId: "requester", issuer: "fake-idp", subject: "requester" },
    scope: { kind: "PROJECT", workspaceId, projectId },
    correlationId: `correlation-${workspaceId}`,
    causationId: `causation-${workspaceId}`,
  } as const);
}

describe("AT-001 QA Pack registration contract", () => {
  it("publishes a schema-valid competency-qa@1.0.0 manifest with pinned digests", async () => {
    const qa = (await import("../../../packages/competency-qa/src/index.ts")) as QaPackExports;
    expect(qa.qaCompetencyManifest, "T021 must publish qaCompetencyManifest").toBeDefined();
    const manifest = qa.qaCompetencyManifest!;

    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:contracts:extensions:competency-pack-manifest:v1",
        manifest,
      ),
    ).not.toThrow();
    expect(manifest.metadata).toEqual(
      expect.objectContaining({ key: "competency-qa", version: "1.0.0" }),
    );

    const workTypes = manifest.workTypes as readonly Readonly<Record<string, unknown>>[];
    expect(workTypes).toHaveLength(1);
    expect(workTypes[0]).toEqual(qa.qaValidationWorkTypeDefinition);
    const intakeSchemaRef = workTypes[0]!.intakeSchemaRef as SchemaReference;
    expect(intakeSchemaRef).toEqual({
      id: "urn:awp:schemas:qa:intake:v1",
      version: 1,
      digest: designContractRegistry.digest("urn:awp:schemas:qa:intake:v1"),
    });

    for (const event of manifest.events as readonly Readonly<Record<string, unknown>>[]) {
      const schemaRef = event.payloadSchemaRef as SchemaReference;
      expect(schemaRef.digest, String(event.eventType)).toBe(
        designContractRegistry.digest(schemaRef.id),
      );
    }
  });

  it("defines only qa.validation@1.0.0 and the closed request taxonomy", async () => {
    const qa = (await import("../../../packages/competency-qa/src/index.ts")) as QaPackExports;
    expect(qa.qaValidationWorkTypeDefinition).toEqual(
      expect.objectContaining({
        key: "qa.validation",
        definitionVersion: "1.0.0",
      }),
    );
    expect(qa.qaRequestKinds).toEqual([
      "feature-validation",
      "smoke",
      "regression",
      "retest",
      "investigation",
    ]);
    expect(qa.qaSessionModes).toEqual(["MANUAL"]);
    expect(qa.qaSessionModes).not.toContain("AUTOMATED");
  });

  it("enables QA intake per Workspace without granting another Workspace", async () => {
    const qa = (await import("../../../packages/competency-qa/src/index.ts")) as QaPackExports;
    const workType = qa.qaValidationWorkTypeDefinition!;
    const intakeSchemaRef = workType.intakeSchemaRef as SchemaReference;
    const definition: WorkTypeDefinitionPin = {
      id: "qa.validation@1.0.0",
      key: "qa.validation",
      version: "1.0.0",
      definitionHash: designContractRegistry.contentDigest(fixtureJson(workType)),
      intakeSchemaRef,
    };
    const service = new WorkManagementService(new InMemoryWorkManagementRepository(), clock, ids);
    const enabled = context("workspace-alpha", "project-alpha");
    const disabled = context("workspace-delta", "project-delta");

    await service.changeEnablement(enabled, definition, "ENABLED", "QA pilot enabled");
    await expect(
      service.createDraft(enabled, "qa.validation", {
        schemaRef: intakeSchemaRef,
        value: { title: "Manual validation", requestKind: "smoke" },
      }),
    ).resolves.toMatchObject({ workspaceId: "workspace-alpha", projectId: "project-alpha" });
    await expect(
      service.createDraft(disabled, "qa.validation", {
        schemaRef: intakeSchemaRef,
        value: { title: "Cross-workspace attempt", requestKind: "smoke" },
      }),
    ).rejects.toThrow("WORK_TYPE_INTAKE_DISABLED");
  });
});
