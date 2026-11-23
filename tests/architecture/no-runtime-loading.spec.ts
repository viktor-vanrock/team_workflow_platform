import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function sources(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? sources(resolve(directory, entry.name))
          : /\.(?:ts|tsx)$/u.test(entry.name)
            ? [resolve(directory, entry.name)]
            : [],
      ),
    )
  ).flat();
}
describe("static extension loading", () => {
  it("forbids runtime URLs, downloads, eval, and computed dynamic imports", async () => {
    const root = resolve(import.meta.dirname, "../../packages");
    for (const file of await sources(root)) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(
        /\beval\s*\(|\bnew\s+Function\s*\(|import\s*\(\s*[`$]|fetch\s*\([^)]*(?:manifest|module|javascript)/u,
      );
    }
  });
});
