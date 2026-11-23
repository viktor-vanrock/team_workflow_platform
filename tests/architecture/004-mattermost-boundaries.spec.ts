import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (directory: string): string =>
  readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name))
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8"))
    .join("\n");

describe("Mattermost provider boundaries", () => {
  it("keeps provider imports out of Core, QA, generic Nest runtime and API", () => {
    expect(source("packages/platform-core/src")).not.toMatch(
      /@awp\/connector-mattermost|mattermost\/api\/v4/iu,
    );
    expect(source("packages/competency-qa/src")).not.toMatch(
      /@awp\/connector-mattermost|mattermost\/api\/v4/iu,
    );
    expect(source("packages/platform-runtime-nest/src")).not.toMatch(
      /@awp\/connector-mattermost/iu,
    );
    expect(source("apps/api/src")).not.toMatch(/@awp\/connector-mattermost/iu);
  });
});
