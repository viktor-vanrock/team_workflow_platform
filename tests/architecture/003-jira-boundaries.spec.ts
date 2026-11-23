import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
async function source(path: string): Promise<string> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const file = resolve(path, entry.name);
        if (entry.isDirectory()) return await source(file);
        return /\.(?:ts|tsx)$/u.test(entry.name) ? await readFile(file, "utf8") : "";
      }),
    )
  ).join("\n");
}

describe("Jira package boundaries", () => {
  it("keeps Core, QA and browser code free of Jira imports", async () => {
    for (const path of [
      "packages/platform-core/src",
      "packages/competency-qa/src",
      "apps/web/src",
    ]) {
      expect(await source(resolve(root, path)), path).not.toMatch(
        /@awp\/connector-jira|from ["'][^"']*connector-jira/iu,
      );
    }
  });

  it("keeps pure Jira protocol free of persistence, Core, QA, Nest and React", async () => {
    const jira = await source(resolve(root, "packages/connector-jira/src"));
    expect(jira).not.toMatch(/typeorm|@awp\/platform-core|@awp\/competency-qa|@nestjs\/|react/iu);
    expect(jira).not.toMatch(/import\s*\(\s*(?:`|[^"'])|createRequire|\brequire\s*\(/u);
  });

  it("keeps Jira persistence free of Core, QA and frameworks", async () => {
    const persistence = await source(
      resolve(root, "packages/connector-jira-persistence-typeorm/src"),
    );
    expect(persistence).not.toMatch(/@awp\/platform-core|@awp\/competency-qa|@nestjs\/|react/iu);
  });

  it("exports both Jira packages statically without runtime loading", async () => {
    const protocol = await source(resolve(root, "packages/connector-jira/src"));
    const persistence = await source(
      resolve(root, "packages/connector-jira-persistence-typeorm/src"),
    );
    expect(protocol).not.toMatch(/import\s*\(\s*(?:`|[^"'])|createRequire|\brequire\s*\(/u);
    expect(persistence).not.toMatch(/import\s*\(\s*(?:`|[^"'])|createRequire|\brequire\s*\(/u);
    expect(await readFile(resolve(root, "packages/connector-jira/package.json"), "utf8")).toContain(
      '"exports"',
    );
    expect(
      await readFile(
        resolve(root, "packages/connector-jira-persistence-typeorm/package.json"),
        "utf8",
      ),
    ).toContain('"exports"');
  });
});
