import { describe, expect, it } from "vitest";

import { defaultClassificationCatalog } from "../../../packages/platform-core/src/index.ts";
import { ResourceClassificationResolver } from "../../../packages/platform-runtime-nest/src/auth/authorization-contributions.ts";

describe("008 canonical classification boundaries", () => {
  it.each(["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"])(
    "resolves %s consistently with Core decisions",
    async (declaredKey) => {
      const actual = await new ResourceClassificationResolver().resolve({
        permission: "artifact.read",
        operation: "artifact.metadata",
        declaredKey,
      });
      const expected = defaultClassificationCatalog.reference(declaredKey);
      expect(actual).toEqual(expected);
      for (const ceiling of ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"]) {
        const maximum = defaultClassificationCatalog.reference(ceiling);
        expect(defaultClassificationCatalog.permits(maximum, actual)).toBe(
          expected.rank <= maximum.rank,
        );
      }
    },
  );
  it("uses canonical conservative defaults for artifact and workspace audit reads", async () => {
    const resolver = new ResourceClassificationResolver();
    expect(
      await resolver.resolve({ permission: "artifact.read", operation: "artifact.metadata" }),
    ).toEqual({ key: "CONFIDENTIAL", rank: 30 });
    expect(
      await resolver.resolve({
        permission: "audit.workspace-security.read",
        operation: "audit.read",
      }),
    ).toEqual({ key: "RESTRICTED", rank: 20 });
  });
  it.each([
    { key: "CONFIDENTIAL", rank: 10 },
    { key: "UNRECOGNIZED", rank: 0 },
  ])("rejects an inconsistent contributed classification $key/$rank", async (reference) => {
    const resolver = new ResourceClassificationResolver([
      {
        componentRef: "fixture.invalid-classification",
        matches: () => true,
        resolve: () => reference,
      },
    ]);
    await expect(
      resolver.resolve({ permission: "artifact.read", operation: "artifact.metadata" }),
    ).rejects.toThrow();
  });
  it("denies unknown declared keys including object-prototype names", async () => {
    for (const declaredKey of ["UNKNOWN", "constructor", "__proto__"])
      await expect(
        new ResourceClassificationResolver().resolve({
          permission: "artifact.read",
          operation: "artifact.metadata",
          declaredKey,
        }),
      ).rejects.toThrow();
  });
});
