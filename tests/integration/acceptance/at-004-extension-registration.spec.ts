import { describe, expect, it } from "vitest";

import { dummyManifest } from "../../../packages/competency-dummy/src/manifest.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  type Clock,
  ExtensionRegistry,
  type IdGenerator,
  InMemoryRegistrationRepository,
  InMemoryWorkManagementRepository,
  reconcileExtensions,
  WorkManagementService,
  type WorkTypeDefinitionPin,
} from "../../../packages/platform-core/src/index.ts";
import { localExtensionCandidates } from "../../../packages/runtime-composition/src/extensions/composition.ts";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const ids = (): IdGenerator => {
  let value = 0;
  return { next: () => `00000000-0000-4000-8000-${(++value).toString().padStart(12, "0")}` };
};
const definition: WorkTypeDefinitionPin = {
  id: "00000000-0000-4000-8000-000000001000",
  key: "dummy.request",
  version: "1.0.0",
  definitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  intakeSchemaRef: dummyManifest.workTypes[0].intakeSchemaRef,
};
const context = {
  actor: { kind: "HUMAN" as const, principalId: "actor", issuer: "issuer", subject: "subject" },
  scope: { kind: "PROJECT" as const, workspaceId: "local-functional", projectId: "alpha" },
  correlationId: "correlation-0001",
  causationId: "causation-0001",
};

describe("AT-004 extension registration and Workspace enablement", () => {
  it("validates schema/SemVer/Core range/digest and reconciles static candidates", async () => {
    const repository = new InMemoryRegistrationRepository();
    const readiness = await reconcileExtensions({
      candidates: localExtensionCandidates,
      schemas: designContractRegistry,
      registry: new ExtensionRegistry(repository, clock, ids()),
      bootInstanceId: "boot-1",
    });
    expect(readiness.status).toBe("READY");
    expect(await repository.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "CompetencyPack",
          key: "dummy",
          version: "1.0.0",
          status: "REGISTERED",
        }),
        expect.objectContaining({
          kind: "CapabilityContract",
          key: "sample.record",
          version: "1.0.0",
        }),
      ]),
    );
    expect(
      (await repository.attempts()).every((attempt) => attempt.observedHash.startsWith("sha256:")),
    ).toBe(true);
  });

  it("enables dummy.request only in the selected Workspace", async () => {
    const work = new WorkManagementService(new InMemoryWorkManagementRepository(), clock, ids());
    const enabled = await work.changeEnablement(context, definition, "ENABLED", "local fixture");
    expect(enabled).toMatchObject({
      workspaceId: "local-functional",
      workTypeKey: "dummy.request",
      intakeState: "ENABLED",
      rowVersion: 1,
    });
  });
});
