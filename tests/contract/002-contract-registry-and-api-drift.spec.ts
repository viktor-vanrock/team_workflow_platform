import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  OfflineSchemaRegistry,
  schemaDocuments,
} from "../../packages/platform-contracts/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
type Json = Record<string, unknown>;
const methods = new Set(["get", "post", "put", "patch", "delete"]);
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Json).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : refs(child),
  );
}
function operations(document: Json) {
  return Object.values(document.paths as Json).flatMap((path) =>
    Object.entries(path as Json)
      .filter(([method]) => methods.has(method))
      .map(([, operation]) => operation as Json),
  );
}

describe("Feature 002 final contract registry and runtime API drift", () => {
  it("rebuilds every schema/example/digest through the offline registry", () => {
    const result = spawnSync(process.execPath, ["tools/contracts/build-registry.mts", "--check"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
    expect(`${result.stdout}\n${result.stderr}`).toContain("Contract registry snapshot is current");
    expect(result.status).toBe(0);
    expect(() => new OfflineSchemaRegistry(schemaDocuments)).not.toThrow();
    expect(
      schemaDocuments.filter(
        ({ contributionKey }) => contributionKey === "002-qa-manual-walking-skeleton",
      ),
    ).toHaveLength(49);
  });

  it("keeps generated API and Mock Hub OpenAPI snapshots byte-current", () => {
    const result = spawnSync(
      process.execPath,
      ["tools/contracts/build-openapi-snapshots.mts", "--check"],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    expect(`${result.stdout}\n${result.stderr}`).toContain("OpenAPI snapshots verified");
    expect(result.status).toBe(0);
  });

  it("uses OpenAPI 3.1, unique operation ids, local refs and source digests", async () => {
    for (const path of [
      "apps/api/openapi.generated.json",
      "apps/mock-hub/openapi.generated.json",
    ]) {
      const document = JSON.parse(await readFile(resolve(root, path), "utf8")) as Json;
      expect(document.openapi).toBe("3.1.0");
      const ids = operations(document).map(({ operationId }) => String(operationId));
      expect(new Set(ids)).toHaveProperty("size", ids.length);
      expect(refs(document).every((ref) => ref.startsWith("#/"))).toBe(true);
      for (const [sourcePath, digest] of Object.entries(
        document["x-awp-source-digests"] as Record<string, string>,
      )) {
        expect(digest).toBe(
          `sha256:${createHash("sha256")
            .update(await readFile(resolve(root, sourcePath)))
            .digest("hex")}`,
        );
      }
    }
  });

  it("keeps AsyncAPI envelopes scoped and forbids remote schema fetch", async () => {
    const document = parse(
      await readFile(
        resolve(root, "specs/002-qa-manual-walking-skeleton/contracts/asyncapi/qa-events.v1.yaml"),
        "utf8",
      ),
    ) as Json;
    expect(String(document.asyncapi)).toMatch(/^3\./u);
    expect(
      refs(document).every(
        (ref) => ref.startsWith("#") || ref.startsWith("urn:awp:") || ref.startsWith("../schemas/"),
      ),
    ).toBe(true);
    expect(JSON.stringify(document)).not.toMatch(/https?:\/\/(?!json-schema\.org)/u);
    const eventSchema = await readFile(
      resolve(
        root,
        "specs/002-qa-manual-walking-skeleton/contracts/schemas/events/qa-events.v1.schema.json",
      ),
      "utf8",
    );
    expect(eventSchema).toContain("workspaceId");
    expect(eventSchema).toContain("projectId");
  });
});
