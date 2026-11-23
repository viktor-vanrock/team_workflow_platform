import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Feature 004 static runtime wiring", () => {
  it("uses named capability contributions and retains prior composition keys", () => {
    expect(read("packages/runtime-composition/src/worker/contributions.ts")).toMatch(
      /capabilityKey/u,
    );
    expect(read("packages/runtime-composition/src/qa/composition.ts")).toMatch(
      /qa-local[\s\S]*qa-jira-local[\s\S]*qa-jira-mattermost-local/u,
    );
    expect(read("apps/worker/src/app.module.ts")).not.toMatch(/import\([^)]*connector/iu);
  });
});
