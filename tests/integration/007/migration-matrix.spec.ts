import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const expected = Object.freeze({
  "packages/platform-persistence-typeorm/src/migrations/core/0150-project-onboarding.ts":
    "ed5fd55333f2416a41f08335874dc60f38e18f2aff3e98d7353deb785571b228",
  "packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts":
    "ac1fa89f9c0eff2ccc8947fc533f56faa1c78e90f908c26729462cc6f8e5ab80",
  "packages/platform-persistence-typeorm/src/migrations/core/0160-artifact-retention-export.ts":
    "84b296ea15d1691350346fa2176232fad5e6cc4aa3fd99cd435be6a2868ff821",
  "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts":
    "6edf0631516468910cfbf263087a58c885c5bc937279c452f67bebeaab81f2f2",
  "packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts":
    "77c11a1c005a1df2da8a8e46520b89a52b30c98f2d87555186d292b6d92254df",
});

describe("Feature 007 aggregate migration matrix", () => {
  it("pins the published Core and QA migration bytes", () => {
    for (const [file, digest] of Object.entries(expected)) {
      expect(
        createHash("sha256")
          .update(readFileSync(resolve(root, file)))
          .digest("hex"),
        file,
      ).toBe(digest);
    }
  });

  it("accepts only the documented PostgreSQL 17/18 matrix images", () => {
    const selected = process.env.AWP_TEST_POSTGRES_IMAGE;
    if (selected !== undefined)
      expect(["postgres:17.7-bookworm", "postgres:18.6-bookworm"]).toContain(selected);
  });
});
