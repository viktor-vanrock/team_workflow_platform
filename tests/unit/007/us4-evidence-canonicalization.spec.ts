import { describe, expect, it } from "vitest";

import {
  canonicalEvidenceBytes,
  evidenceContentHash,
} from "../../../packages/competency-qa/src/domain/evidence-manifest-v2.ts";

describe("US4 JCS", () => {
  it("has stable RFC8785-style bytes, numbers, strings and hash", () => {
    expect(canonicalEvidenceBytes({ z: 1, a: "é", n: 1.5 })).toBe(
      canonicalEvidenceBytes({ n: 1.5, a: "é", z: 1 }),
    );
    expect(evidenceContentHash({ a: ["a", "b"] })).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
