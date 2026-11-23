import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("Feature 007 static runtime wiring", () => {
  it("statically composes onboarding for API and worker without dynamic discovery", () => {
    const compositionPath = resolve(
      root,
      "packages/runtime-composition/src/onboarding/composition.ts",
    );
    expect(existsSync(compositionPath)).toBe(true);
    const api = readFileSync(resolve(root, "apps/api/src/app.module.ts"), "utf8");
    const worker = readFileSync(resolve(root, "apps/worker/src/app.module.ts"), "utf8");
    const rootIndex = readFileSync(
      resolve(root, "packages/runtime-composition/src/index.ts"),
      "utf8",
    );
    expect(rootIndex).toContain("./onboarding/composition.ts");
    expect(`${api}\n${worker}`).toContain("onboarding");
    expect(`${api}\n${worker}\n${rootIndex}`).not.toMatch(/readdir|glob|dynamic import/iu);
  });
});
