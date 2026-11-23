import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function sources(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? sources(resolve(directory, entry.name))
          : entry.name.endsWith(".ts")
            ? [resolve(directory, entry.name)]
            : [],
      ),
    )
  ).flat();
}
describe("Core-only composition", () => {
  it("contains no Pack, Connector, Nest, or TypeORM dependency", async () => {
    const files = await sources(resolve(import.meta.dirname, "../../packages/platform-core/src"));
    const combined = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(combined).not.toMatch(/@awp\/competency-|@awp\/connector-|@nestjs\/|typeorm/u);
  });
});
