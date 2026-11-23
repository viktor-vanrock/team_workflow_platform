import { describe, expect, it } from "vitest";

import { dummyManifest } from "../../packages/competency-dummy/src/manifest.ts";
import { designContractRegistry } from "../../packages/platform-contracts/src/index.ts";
import {
  type Clock,
  ExtensionRegistry,
  type IdGenerator,
  InMemoryRegistrationRepository,
  reconcileExtensions,
} from "../../packages/platform-core/src/index.ts";

const clock: Clock = { now: () => new Date("2026-01-01") };
const ids: IdGenerator = {
  next: (() => {
    let index = 0;
    return () => `id-${++index}`;
  })(),
};
describe("extension registration collision isolation", () => {
  it("records a rejected attempt without mutating canonical registration", async () => {
    const repository = new InMemoryRegistrationRepository();
    const registry = new ExtensionRegistry(repository, clock, ids);
    const candidate = {
      sourceComponentRef: "dummy",
      manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
      manifest: dummyManifest,
      required: true,
    } as const;
    expect(
      (
        await reconcileExtensions({
          candidates: [candidate],
          schemas: designContractRegistry,
          registry,
          bootInstanceId: "boot-1",
        })
      ).status,
    ).toBe("READY");
    const drifted = structuredClone(dummyManifest) as Record<string, unknown>;
    (drifted.metadata as Record<string, unknown>).displayName = "Tampered Pack";
    expect(
      (
        await reconcileExtensions({
          candidates: [{ ...candidate, manifest: drifted }],
          schemas: designContractRegistry,
          registry,
          bootInstanceId: "boot-2",
        })
      ).status,
    ).toBe("DOWN");
    const registrations = await repository.list();
    expect(registrations).toHaveLength(1);
    expect((registrations[0]!.manifest.metadata as { displayName: string }).displayName).toBe(
      "Dummy Competency Pack",
    );
    expect(await repository.attempts()).toEqual([
      expect.objectContaining({ outcome: "ACCEPTED" }),
      expect.objectContaining({
        outcome: "REJECTED",
        diagnostics: [expect.stringContaining("IMMUTABLE_DIGEST_COLLISION")],
      }),
    ]);
  });
});
