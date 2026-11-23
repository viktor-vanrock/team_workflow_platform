import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Feature 003 design contracts", () => {
  it("parses every document and validates refs and closed action bodies", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "tools/contracts/verify-003-contracts.mts"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toMatch(/PASS; documents=19; refs=296; actionSchemas=4/u);
  });
});
