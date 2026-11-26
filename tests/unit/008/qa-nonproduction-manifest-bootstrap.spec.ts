import { describe, expect, it, vi } from "vitest";
import {
  qaCompetencyManifestV15,
  qaValidationWorkTypeDefinitionV15,
} from "../../../packages/competency-qa/src/manifest-v1.5.ts";
import { createHash } from "node:crypto";
import { registerQaNonproductionManifest } from "../../../packages/runtime-composition/src/bootstrap/qa-nonproduction-manifest.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
describe("non-production QA manifest registration", () => {
  it("fails closed outside dev", async () => {
    const transaction = vi.fn();
    for (const environment of [undefined, "prod", "local"]) {
      await expect(
        registerQaNonproductionManifest({ transaction } as never, environment),
      ).rejects.toThrow("QA_NONPRODUCTION_MANIFEST_DEV_REQUIRED");
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("reuses immutable rows and does not switch the workspace work type", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id,manifest_hash"))
        return [
          {
            id: "pack",
            manifest_hash: hash(qaCompetencyManifestV15),
            registration_status: "REGISTERED",
          },
        ];
      if (sql.startsWith("SELECT pack_registration_id"))
        return [
          {
            pack_registration_id: "pack",
            definition_hash: hash(qaValidationWorkTypeDefinitionV15),
            lifecycle_status: "ACTIVE",
          },
        ];
      return [];
    });
    const source = {
      transaction: async (work: (manager: unknown) => Promise<void>) => await work({ query }),
    };
    await registerQaNonproductionManifest(source as never, "dev");
    await registerQaNonproductionManifest(source as never, "dev");
    expect(query.mock.calls.filter(([sql]) => sql.includes("ON CONFLICT")).length).toBe(4);
    expect(query.mock.calls.some(([sql]) => sql.includes("workspace_work_types"))).toBe(false);
  });
  it("rejects a conflicting existing registration", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.startsWith("SELECT id,manifest_hash")
        ? [{ id: "pack", manifest_hash: "different", registration_status: "REGISTERED" }]
        : [],
    );
    const source = {
      transaction: async (work: (manager: unknown) => Promise<void>) => await work({ query }),
    };
    await expect(registerQaNonproductionManifest(source as never, "dev")).rejects.toThrow(
      "QA_NONPRODUCTION_MANIFEST_CONFLICT",
    );
  });
});
