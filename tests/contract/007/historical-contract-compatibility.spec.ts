import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { evidenceIntegrityModeForSchema } from "../../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";

const root = resolve(import.meta.dirname, "../../..");
const pins = Object.freeze({
  "specs/001-extension-kernel-local-skeleton/contracts/schemas/integration/project-integration-binding-version.v1.schema.json":
    "220146ae5f5c9613828402619263bf06349c2dfdff2af376716b378c248b79e9",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/qa-project-context.v1.schema.json":
    "fbe32b2d5c67779df3129076c76b57f5b9e8045f6815ca3a777c859598e8c755",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/target-snapshot.v1.schema.json":
    "763ad35bff676bdca34b4b7305dd952a82565f358c72340c19c9be97982e87ec",
  "specs/002-qa-manual-walking-skeleton/contracts/schemas/qa/evidence-manifest.v1.schema.json":
    "cb53f733c89a1ff0e307951fdbe56c91db55b465cb775bc20713622c54a7e0e8",
});

describe("Feature 007 historical contract compatibility", () => {
  it("byte-pins every consumed published v1 identity", () => {
    for (const [path, expected] of Object.entries(pins)) {
      expect(
        createHash("sha256")
          .update(readFileSync(resolve(root, path)))
          .digest("hex"),
        path,
      ).toBe(expected);
    }
  });

  it("uses additive v2 identities and never upgrades v1 evidence semantics by reinterpretation", () => {
    const target = JSON.parse(
      readFileSync(
        resolve(
          root,
          "specs/007-project-onboarding-evidence-security/contracts/schemas/qa/target-snapshot.v2.schema.json",
        ),
        "utf8",
      ),
    ) as { $id: string };
    const evidence = JSON.parse(
      readFileSync(
        resolve(
          root,
          "specs/007-project-onboarding-evidence-security/contracts/schemas/qa/evidence-manifest.v2.schema.json",
        ),
        "utf8",
      ),
    ) as { $id: string };
    expect(target.$id).toBe("urn:awp:schemas:007:target-snapshot:v2");
    expect(evidence.$id).toBe("urn:awp:schemas:007:evidence-manifest:v2");
    expect(evidenceIntegrityModeForSchema("urn:awp:schemas:qa:evidence-manifest:v1")).toBe(
      "LEGACY_INTEGRITY_ONLY",
    );
    expect(evidenceIntegrityModeForSchema(evidence.$id)).toBe("SIGNED_V2");
  });
});
