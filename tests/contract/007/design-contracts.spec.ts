import { describe, expect, it } from "vitest";

import {
  canonicalize007Contract,
  verify007Contracts,
} from "../../../tools/contracts/verify-007-contracts.mts";

describe("Feature 007 immutable design contracts", () => {
  it("strictly validates the complete closed contract set and all declared vectors", () => {
    const result = verify007Contracts();
    expect(result).toMatchObject({
      status: "PASS",
      schemas: 16,
      examples: 7,
      positiveExamples: 3,
      negativeExamples: 4,
      openapiOperations: 20,
      publishedOpenapiOperations: 18,
      asyncapiChannels: 3,
      asyncapiOperations: 5,
    });
    expect(result.references).toBeGreaterThan(400);
    expect(Object.keys(result.schemaDigests)).toHaveLength(16);
    expect(new Set(Object.values(result.schemaDigests))).toHaveProperty("size", 16);
    expect(result.errors).toEqual([]);
  });

  it("uses deterministic RFC 8785/JCS-compatible key ordering", () => {
    expect(canonicalize007Contract({ z: 0, a: [true, { y: "é", x: null }] })).toBe(
      '{"a":[true,{"x":null,"y":"é"}],"z":0}',
    );
    expect(() => canonicalize007Contract(Number.POSITIVE_INFINITY)).toThrow("non-finite");
  });
});
