import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EphemeralJiraSecretLease,
  jiraPilotMetadataContentHash,
  type JiraPilotMetadataPackage,
  validateJiraPilotMetadataPackage,
} from "../../../packages/platform-contracts/src/extensions/jira-pilot-metadata.ts";

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
    const output: Record<string, unknown> = structuredClone(left) as Record<string, unknown>;
    for (const [key, value] of Object.entries(right))
      output[key] = key in output ? merge(output[key], value) : structuredClone(value);
    return output;
  }
  return structuredClone(right);
}

function rehash(value: unknown): unknown {
  const result = object(structuredClone(value));
  result.contentHash = jiraPilotMetadataContentHash(result);
  return result;
}

describe("JiraPilotMetadataPackage@1", () => {
  const local = readJson("config/local/jira-pilot-metadata.v1.json");

  it("accepts the deterministic secret-free local C1 package and its exact content hash", () => {
    const value = validateJiraPilotMetadataPackage(local);
    expect(value).toMatchObject({
      schemaVersion: 1,
      environment: "LOCAL",
      adapter: { family: "jira-cloud-v3" },
      auth: { kind: "LOCAL_FAKE" },
    });
    expect(value.contentHash).toBe(jiraPilotMetadataContentHash(value));
    expect(JSON.stringify(value)).not.toMatch(/Bearer |Basic |clientSecret|accessToken|password/iu);
  });

  it("rejects invalid edition/auth/build/webhook/concurrency combinations", () => {
    const fixture = object(readJson("tests/fixtures/003/jira-pilot-metadata.invalid.json"));
    const cases = fixture.cases as readonly Readonly<{
      id: string;
      patch: unknown;
      expectedCode: string;
    }>[];
    expect(cases).toHaveLength(5);
    for (const candidate of cases) {
      const value = rehash(merge(local, candidate.patch));
      expect(() => validateJiraPilotMetadataPackage(value), candidate.id).toThrow(
        candidate.expectedCode,
      );
    }
  });

  it("rejects semantic horizon drift even when schema and content hash are otherwise valid", () => {
    const value = rehash(
      merge(local, { webhook: { retryHorizonSeconds: 7200, dedupeHorizonSeconds: 3600 } }),
    );
    expect(() => validateJiraPilotMetadataPackage(value)).toThrow(
      "JIRA_PILOT_DEDUPE_HORIZON_INVALID",
    );
  });

  it("rejects a stale content hash", () => {
    const value = merge(local, { rateBudget: { burst: 26 } });
    expect(() => validateJiraPilotMetadataPackage(value)).toThrow(
      "JIRA_PILOT_CONTENT_HASH_MISMATCH",
    );
  });

  it("rejects embedded secret material before it can cross a runtime boundary", () => {
    const value = merge(local, { auth: { clientSecret: "do-not-persist" } });
    expect(() => validateJiraPilotMetadataPackage(value)).toThrow(
      "JIRA_PILOT_SECRET_MATERIAL_FORBIDDEN",
    );
  });

  it("keeps secret bytes outside serializable lease metadata and zeroizes on close", () => {
    const lease = new EphemeralJiraSecretLease(
      {
        schemaVersion: 1,
        leaseId: "00000000-0000-4000-8000-000000000399",
        secretRefHash: `sha256:${"1".repeat(64)}`,
        secretVersionRef: "local-v1",
        allowedUseHash: `sha256:${"2".repeat(64)}`,
        issuedAt: "2026-08-28T00:00:00Z",
        expiresAt: "2026-08-28T00:05:00Z",
        redactionToken: "local_redaction_token_003",
      },
      new TextEncoder().encode("runtime-only-secret"),
    );

    expect(lease.use((secret) => new TextDecoder().decode(secret))).toBe("runtime-only-secret");
    expect(JSON.stringify(lease)).not.toContain("runtime-only-secret");
    lease.close();
    expect(() => lease.use(() => undefined)).toThrow("JIRA_SECRET_LEASE_CLOSED");
  });

  it("exports a compile-time package identity", () => {
    const value = local as JiraPilotMetadataPackage;
    expect(value.schemaVersion).toBe(1);
  });
});
