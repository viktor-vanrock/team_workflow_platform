import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertFeature005LiveNonProd,
  gitLabPilotMetadataContentHash,
  validateFeature005GitLabMetadata,
} from "../../../tools/verification/feature-005-nonprod-metadata-lib.mts";

const workspace = resolve(import.meta.dirname, "../../..");
type JsonRecord = Record<string, unknown>;
const read = (path: string): JsonRecord =>
  JSON.parse(readFileSync(resolve(workspace, path), "utf8")) as JsonRecord;
function merge(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const value = structuredClone(base);
  for (const [key, child] of Object.entries(patch)) {
    value[key] =
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      value[key] !== null &&
      typeof value[key] === "object" &&
      !Array.isArray(value[key])
        ? merge(value[key] as JsonRecord, child as JsonRecord)
        : structuredClone(child);
  }
  return value;
}
function rehash(value: JsonRecord): JsonRecord {
  value.contentHash = gitLabPilotMetadataContentHash(value);
  return value;
}

describe("Feature 005 GitLab pilot metadata verifier", () => {
  const base = read("config/local/gitlab-pilot-metadata.v1.json");
  const valid = read("tests/fixtures/005/gitlab-pilot-metadata.local.v1.json")
    .validCases as readonly Readonly<{ id: string; patch: JsonRecord; liveDisposition: string }>[];
  const invalid = read("tests/fixtures/005/gitlab-pilot-metadata.live.invalid.v1.json")
    .cases as readonly Readonly<{ id: string; patch: JsonRecord; expectedCode: string }>[];

  it.each(valid)("accepts $id with semantic content hashing", ({ patch, liveDisposition }) => {
    const metadata = validateFeature005GitLabMetadata(rehash(merge(base, patch)));
    expect(metadata.contentHash).toBe(gitLabPilotMetadataContentHash(metadata));
    if (liveDisposition === "LIVE_NONPROD")
      expect(assertFeature005LiveNonProd(metadata).protocol).toBe("https:");
  });

  it.each(invalid)(
    "rejects $id before any network or secret resolution",
    ({ patch, expectedCode }) => {
      expect(() => validateFeature005GitLabMetadata(rehash(merge(base, patch)))).toThrow(
        expectedCode,
      );
    },
  );

  it("rejects semantic hash drift and embedded secret material", () => {
    expect(() =>
      validateFeature005GitLabMetadata({ ...base, allowedRefs: ["refs/heads/changed"] }),
    ).toThrow("GITLAB_PILOT_CONTENT_HASH_MISMATCH");
    expect(() =>
      validateFeature005GitLabMetadata(rehash({ ...base, accessToken: "forbidden" })),
    ).toThrow("GITLAB_PILOT_SECRET_MATERIAL_FORBIDDEN");
  });
});
