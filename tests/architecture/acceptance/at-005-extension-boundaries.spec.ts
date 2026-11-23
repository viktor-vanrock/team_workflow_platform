import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function combined(directory: string): Promise<string> {
  const parts = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
      entry.isDirectory()
        ? combined(resolve(directory, entry.name))
        : /\.(?:ts|tsx)$/u.test(entry.name)
          ? readFile(resolve(directory, entry.name), "utf8")
          : "",
    ),
  );
  return parts.join("\n");
}
describe("AT-005 extension boundaries", () => {
  it("keeps Core, Pack, and Connector directions static and independent", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const [core, pack, connector] = await Promise.all([
      combined(resolve(root, "packages/platform-core/src")),
      combined(resolve(root, "packages/competency-dummy/src")),
      combined(resolve(root, "packages/connector-mock/src")),
    ]);
    expect(core).not.toMatch(/@awp\/(?:competency-dummy|connector-mock)/u);
    expect(pack).not.toMatch(/@awp\/connector-/u);
    expect(connector).not.toMatch(/@awp\/competency-/u);
    expect(`${core}\n${pack}\n${connector}`).not.toMatch(/import\s*\(\s*[`$]|\beval\s*\(/u);
  });
});
