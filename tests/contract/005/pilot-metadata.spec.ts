import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  gitLabPilotMetadataContentHash,
  type GitLabPilotMetadataPackage,
  validateGitLabPilotMetadataPackage,
} from "../../../packages/platform-contracts/src/extensions/gitlab-pilot-metadata.ts";

const workspace = resolve(import.meta.dirname, "../../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(workspace, path), "utf8")) as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("fixture must be an object");
  return value as Record<string, unknown>;
}

function merge(left: unknown, right: unknown): unknown {
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const output = structuredClone(left) as Record<string, unknown>;
    for (const [key, value] of Object.entries(right))
      output[key] = key in output ? merge(output[key], value) : structuredClone(value);
    return output;
  }
  return structuredClone(right);
}

describe("GitLabPilotMetadataPackage@1.0.0", () => {
  const local = readJson("config/local/gitlab-pilot-metadata.v1.json");

  it("accepts the deterministic secret-free local package and exact three-role pins", () => {
    const value = validateGitLabPilotMetadataPackage(local);

    expect(value).toMatchObject({
      schemaVersion: "gitlab-pilot-metadata@1.0.0",
      deploymentPurpose: "CONFORMANCE_VALIDATION",
      contourKey: "qa-jira-gitlab-local",
      environmentClass: "LOCAL",
      operatorOptIn: true,
      productionDenied: true,
    });
    expect(value.configurationPins.map(({ logicalRole }) => logicalRole).sort()).toEqual([
      "ARTIFACT_SOURCE",
      "SOURCE_CONTEXT",
      "TEST_EXECUTION",
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /Bearer |Basic |clientSecret|accessToken|password|privateKey|secretValue/iu,
    );
  });

  it("rejects invalid identity routing, scope, schema, rehearsal, release and production fixtures", () => {
    const fixture = object(readJson("tests/fixtures/005/gitlab-pilot-metadata.invalid.json"));
    const cases = fixture.cases as readonly Readonly<{
      id: string;
      patch: unknown;
      expectedCode: string;
    }>[];
    expect(cases).toHaveLength(6);
    for (const candidate of cases) {
      expect(
        () => validateGitLabPilotMetadataPackage(merge(local, candidate.patch)),
        candidate.id,
      ).toThrow(candidate.expectedCode);
    }
  });

  it("recomputes the RFC 8785/JCS root content hash with only root contentHash omitted", () => {
    const value = object(structuredClone(local));
    expect(gitLabPilotMetadataContentHash(value)).toBe(value.contentHash);
    value.generatedAt = "2026-09-01T07:45:01.000Z";
    expect(() => validateGitLabPilotMetadataPackage(value)).toThrow(
      "GITLAB_PILOT_CONTENT_HASH_MISMATCH",
    );
  });

  it("requires three distinct secret references and credential fingerprints", () => {
    const value = object(structuredClone(local));
    const identities = object(value.identities);
    const read = object(identities.read);
    const trigger = object(identities.trigger);
    trigger.secretRef = read.secretRef;
    trigger.credentialFingerprint = read.credentialFingerprint;

    expect(() => validateGitLabPilotMetadataPackage(value)).toThrow(
      "GITLAB_PILOT_IDENTITY_SEPARATION_INVALID",
    );
  });

  it("rejects embedded secret material before schema publication", () => {
    const value = merge(local, { identities: { trigger: { accessToken: "do-not-persist" } } });
    expect(() => validateGitLabPilotMetadataPackage(value)).toThrow(
      "GITLAB_PILOT_SECRET_MATERIAL_FORBIDDEN",
    );
  });

  it("exports a compile-time package identity", () => {
    const value = local as GitLabPilotMetadataPackage;
    expect(value.schemaVersion).toBe("gitlab-pilot-metadata@1.0.0");
  });
});
