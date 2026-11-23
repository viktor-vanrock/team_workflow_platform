import { describe, expect, it } from "vitest";

import { assembleEvidencePackage } from "../../../packages/competency-qa/src/application/assemble-evidence-package.ts";

describe("US4 package", () => {
  it("requires human-signed verdict and valid required signatures", () => {
    const base = {
      workspaceId: "w",
      projectId: "p",
      workItemId: "work",
      manifestRefs: [{ id: "m", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const }],
      signatureRefs: [
        {
          id: "s",
          version: 1,
          contentHash: `sha256:${"b".repeat(64)}` as const,
          status: "VALID" as const,
        },
      ],
      qaVerdict: {
        id: "v",
        version: 1,
        contentHash: `sha256:${"c".repeat(64)}` as const,
        actorKind: "HUMAN" as const,
        signed: true,
      },
      createdBy: { kind: "HUMAN" as const, principalId: "lead" },
      createdAt: "2026-09-03T12:00:00Z",
    };
    expect(assembleEvidencePackage(base).contentHash).toMatch(/^sha256:/u);
    expect(() =>
      assembleEvidencePackage({ ...base, qaVerdict: { ...base.qaVerdict, signed: false } }),
    ).toThrow("EVIDENCE_PACKAGE_VERDICT_REQUIRED");
  });
});
