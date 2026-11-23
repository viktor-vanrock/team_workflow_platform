import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type MattermostPilotMetadataPackage,
  validateMattermostPilotMetadataPackage,
} from "../../../packages/platform-contracts/src/extensions/mattermost-pilot-metadata.ts";

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

describe("MattermostPilotMetadataPackage@1.0.0", () => {
  const local = readJson("config/local/mattermost-pilot-metadata.v1.json");

  it("accepts the deterministic secret-free local package", () => {
    const value = validateMattermostPilotMetadataPackage(local);

    expect(value).toMatchObject({
      schemaVersion: "mattermost-pilot-metadata@1.0.0",
      contourKey: "qa-jira-mattermost-local",
      environmentClass: "LOCAL",
      operatorOptIn: true,
      productionDenied: true,
    });
    expect(JSON.stringify(value)).not.toMatch(
      /Bearer |Basic |clientSecret|accessToken|password|botToken/iu,
    );
  });

  it("rejects invalid shape, scope, key, retention, reconciliation and production cases", () => {
    const fixture = object(readJson("tests/fixtures/004/mattermost-pilot-metadata.invalid.json"));
    const cases = fixture.cases as readonly Readonly<{
      id: string;
      patch: unknown;
      expectedCode: string;
    }>[];
    expect(cases).toHaveLength(6);
    for (const candidate of cases) {
      expect(
        () => validateMattermostPilotMetadataPackage(merge(local, candidate.patch)),
        candidate.id,
      ).toThrow(candidate.expectedCode);
    }
  });

  it("rejects embedded secret material before publication", () => {
    const value = merge(local, { callbackGateway: { clientSecret: "do-not-persist" } });
    expect(() => validateMattermostPilotMetadataPackage(value)).toThrow(
      "MATTERMOST_PILOT_SECRET_MATERIAL_FORBIDDEN",
    );
  });

  it("exports a compile-time package identity", () => {
    const value = local as MattermostPilotMetadataPackage;
    expect(value.schemaVersion).toBe("mattermost-pilot-metadata@1.0.0");
  });
});
