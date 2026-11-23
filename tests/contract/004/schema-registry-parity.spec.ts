import { describe, expect, it } from "vitest";

import { schemaDocuments } from "../../../packages/platform-contracts/src/generated/schema-documents.ts";

describe("004 offline schema registry parity", () => {
  it("keeps immutable 001/002/003/004 documents and examples", () => {
    const sources = schemaDocuments.map(({ sourcePath }) => sourcePath);
    for (const prefix of ["specs/001-", "specs/002-", "specs/003-", "specs/004-"])
      expect(sources.some((path) => path.startsWith(prefix))).toBe(true);
    expect(new Set(schemaDocuments.map(({ id }) => id)).size).toBe(schemaDocuments.length);
    expect(
      schemaDocuments.filter(({ sourcePath }) => sourcePath.startsWith("specs/004-")).length,
    ).toBeGreaterThanOrEqual(43);
    for (const document of schemaDocuments)
      expect(document.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
