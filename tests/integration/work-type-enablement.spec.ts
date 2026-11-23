import { describe, expect, it } from "vitest";

import { dummyManifest } from "../../packages/competency-dummy/src/manifest.ts";
import {
  type Clock,
  type IdGenerator,
  InMemoryWorkManagementRepository,
  WorkManagementService,
  type WorkTypeDefinitionPin,
} from "../../packages/platform-core/src/index.ts";

const clock: Clock = { now: () => new Date("2026-01-01") };
const ids: IdGenerator = {
  next: (() => {
    let index = 0;
    return () => `id-${++index}`;
  })(),
};
const definition: WorkTypeDefinitionPin = {
  id: "definition",
  key: "dummy.request",
  version: "1.0.0",
  definitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  intakeSchemaRef: dummyManifest.workTypes[0].intakeSchemaRef,
};
const context = {
  actor: { kind: "HUMAN" as const, principalId: "actor", issuer: "issuer", subject: "subject" },
  scope: { kind: "PROJECT" as const, workspaceId: "workspace", projectId: "project" },
  correlationId: "correlation-0001",
  causationId: "causation-0001",
};
describe("Work Type enable -> disable history", () => {
  it("blocks new intake after disable while historical Work Item stays readable", async () => {
    const service = new WorkManagementService(new InMemoryWorkManagementRepository(), clock, ids);
    await service.changeEnablement(context, definition, "ENABLED", "start");
    const draft = await service.createDraft(context, "dummy.request", {
      schemaRef: definition.intakeSchemaRef,
      value: { title: "Sample", message: "Hello" },
    });
    const workItem = await service.submitDraft(context, draft.id, 1);
    await service.changeEnablement(context, definition, "DISABLED", "maintenance", 1);
    await expect(
      service.createDraft(context, "dummy.request", {
        schemaRef: definition.intakeSchemaRef,
        value: { title: "New", message: "Blocked" },
      }),
    ).rejects.toThrow(/DISABLED/u);
    expect(await service.getWorkItem(context, workItem.id)).toEqual(workItem);
  });
  it("enforces optimistic concurrency on enablement", async () => {
    const service = new WorkManagementService(new InMemoryWorkManagementRepository(), clock, ids);
    await service.changeEnablement(context, definition, "ENABLED", "start");
    await expect(
      service.changeEnablement(context, definition, "DISABLED", "stale", 0),
    ).rejects.toThrow(/CONCURRENCY/u);
  });
});
