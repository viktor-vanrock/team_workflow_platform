import { describe, expect, it } from "vitest";

import { schemaDocuments } from "../../../packages/platform-contracts/src/generated/schema-documents.ts";

describe("003 offline registry parity", () => {
  it("contains immutable 001/002/003 documents and retains operational 1.0", () => {
    const sources = schemaDocuments.map(({ sourcePath }) => sourcePath);
    expect(sources.some((path) => path.startsWith("specs/001-"))).toBe(true);
    expect(sources.some((path) => path.startsWith("specs/002-"))).toBe(true);
    expect(sources.some((path) => path.startsWith("specs/003-"))).toBe(true);
    expect(
      schemaDocuments.some(({ id }) => id.includes("operational-work-item") && id.includes("v1")),
    ).toBe(true);
    expect(new Set(schemaDocuments.map(({ id }) => id)).size).toBe(schemaDocuments.length);
  });
});
