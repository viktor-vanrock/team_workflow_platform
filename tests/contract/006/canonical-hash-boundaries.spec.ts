import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  type JsonValue,
  OfflineSchemaRegistry,
  schemaDocuments,
  sha256,
} from "../../../packages/platform-contracts/src/index.ts";

const schemaRoot = resolve(
  import.meta.dirname,
  "../../../specs/006-queue-triage-capacity-sla/contracts/schemas",
);
const schemas = readdirSync(schemaRoot)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map(
    (name) =>
      JSON.parse(readFileSync(resolve(schemaRoot, name), "utf8")) as Record<string, JsonValue>,
  );

function contentHash<T extends Readonly<Record<string, JsonValue>>>(
  value: T,
  omitted: readonly string[],
): string {
  return sha256(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !omitted.includes(key)),
    ) as JsonValue,
  );
}

describe("Feature 006 canonical hash boundaries", () => {
  it("uses stable RFC 8785/JCS bytes and rejects invalid Unicode", () => {
    expect(canonicalize({ z: 1, a: [true, "x"] })).toBe('{"a":[true,"x"],"z":1}');
    expect(sha256({ z: 1, a: [true, "x"] })).toBe(sha256({ a: [true, "x"], z: 1 }));
    expect(() => canonicalize({ invalid: String.fromCharCode(0xd800) })).toThrow(/surrogate/u);
  });

  it("computes non-recursive content/action/evaluation hashes", () => {
    const semantic = {
      id: "visible",
      revision: 1,
      semanticHash: "old",
      privateHeadVersion: 7,
    } as const;
    expect(contentHash(semantic, ["semanticHash", "privateHeadVersion"])).toBe(
      sha256({ id: "visible", revision: 1 }),
    );

    const clock = {
      clockRevisionRef: { id: "clock", version: 2, semanticHash: "old" },
      state: "RUNNING",
      asOf: "dynamic",
      evaluationHash: "old",
    } as const;
    expect(
      contentHash(clock as unknown as Record<string, JsonValue>, [
        "clockRevisionRef",
        "asOf",
        "evaluationHash",
      ]),
    ).toBe(sha256({ state: "RUNNING" }));
    expect(contentHash(clock as unknown as Record<string, JsonValue>, ["evaluationHash"])).not.toBe(
      contentHash(clock as unknown as Record<string, JsonValue>, [
        "clockRevisionRef",
        "asOf",
        "evaluationHash",
      ]),
    );
  });

  it("keeps public hashes stable under hidden-only churn", () => {
    const publicProjection = {
      workspaceId: "w",
      authorizedProjectSetHash: "sha256:visible",
      visibleCount: 2,
    } as const;
    const before = { publicProjection, hiddenGlobalHeadVersion: 9, hiddenProjectCount: 3 };
    const after = { publicProjection, hiddenGlobalHeadVersion: 10, hiddenProjectCount: 4 };
    expect(sha256(before.publicProjection)).toBe(sha256(after.publicProjection));
    expect(sha256(before as unknown as JsonValue)).not.toBe(sha256(after as unknown as JsonValue));
  });

  it("resolves every Feature 006 immutable ref after a fresh registry restart", () => {
    const featureIds = schemas.map((schema) => String(schema.$id)).sort();
    const first = new OfflineSchemaRegistry(schemaDocuments);
    const restarted = new OfflineSchemaRegistry(schemaDocuments);
    expect(featureIds).toHaveLength(16);
    for (const id of featureIds) {
      expect(first.digest(id)).toBe(sha256(schemas.find((schema) => schema.$id === id)!));
      expect(restarted.document(id)).toEqual(first.document(id));
    }
  });
});
