import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("module boundary graph", () => {
  it("rejects forbidden directions, deep aliases, and cycles", () => {
    const root = resolve(import.meta.dirname, "../..");
    const result = spawnSync(process.execPath, ["tools/architecture/check-import-graph.mts"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no deep imports, cycles, or dynamic loading");
  });
});
