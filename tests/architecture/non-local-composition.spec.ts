import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nonLocalComposition } from "../../packages/runtime-composition/src/non-local.composition.ts";

const root = resolve(import.meta.dirname, "../..");
const relativeImport = /(?:from\s+|import\s*\()(["'])(\.\.?\/[^"']+)\1/gu;
async function dependencyClosure(entry: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = await readFile(entry, "utf8");
  for (const match of source.matchAll(relativeImport)) {
    const specifier = match[2]!;
    const path = resolve(dirname(entry), specifier);
    await dependencyClosure(path, seen);
  }
  return seen;
}

describe("Core-only and non-local production composition", () => {
  it("uses only Core entities/migrations and registers no local routes or providers", () => {
    expect(nonLocalComposition.extensionCandidates).toEqual([]);
    expect(nonLocalComposition.localRoutes).toEqual([]);
    expect(nonLocalComposition.localProviders).toEqual([]);
    expect(nonLocalComposition.entities.length).toBeGreaterThan(0);
    expect(
      nonLocalComposition.entities.some((entity) => entity.options.tableName === "dummy_requests"),
    ).toBe(false);
    expect(
      nonLocalComposition.migrations
        .map((Migration) => new Migration().name)
        .some((name) => name?.includes("Dummy")),
    ).toBe(false);
  });

  it("keeps the exported non-local entry dependency closure free of Dummy/Mock/Fake/local-admin implementation files", async () => {
    const entry = resolve(root, "packages/runtime-composition/src/non-local.composition.ts");
    const paths = [...(await dependencyClosure(entry))].map((path) => path.slice(root.length + 1));
    expect(paths).toContain("packages/runtime-composition/src/non-local.composition.ts");
    expect(paths.join("\n")).not.toMatch(
      /competency-dummy|connector-mock|fake-idp|mock-hub|local-persona|local-walking|deterministic-fake/iu,
    );
    const manifest = JSON.parse(
      await readFile(resolve(root, "packages/runtime-composition/package.json"), "utf8"),
    ) as { exports: Record<string, string> };
    expect(manifest.exports["./non-local"]).toBe("./src/non-local.composition.ts");
  });
});
