import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string =>
  existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : "";
const dynamicLoading =
  /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])/u;

describe("Feature 005 static runtime wiring", () => {
  it("adds named GitLab compositions without rebinding any prior selector", () => {
    const composition = `${read("packages/runtime-composition/src/qa/composition.ts")}\n${read("packages/runtime-composition/src/config/environment.ts")}\n${read("packages/runtime-composition/src/non-local.composition.ts")}`;
    for (const existing of [
      "foundation",
      "qa-local",
      "qa-jira-local",
      "qa-jira-mattermost-local",
      "qa-jira-nonprod",
      "qa-jira-mattermost-nonprod",
    ]) {
      expect(composition, existing).toContain(existing);
    }
    expect(composition).toContain("qa-jira-gitlab-local");
    expect(composition).toContain("qa-jira-gitlab-mattermost-local");
  });

  it("assembles GitLab only through static runtime-composition exports", () => {
    const gitlabComposition = read("packages/runtime-composition/src/gitlab/composition.ts");
    const runtimeIndex = read("packages/runtime-composition/src/index.ts");
    expect(gitlabComposition).toMatch(
      /connectorGitLab|gitlabMigration|gitlabEntit|gitlab.*Contribution/iu,
    );
    expect(runtimeIndex).toMatch(/gitlab\/composition/iu);
    expect(`${gitlabComposition}\n${runtimeIndex}`).not.toMatch(dynamicLoading);
  });

  it("keeps deployable apps on closed static imports", () => {
    const apps = `${read("apps/api/src/app.module.ts")}\n${read("apps/worker/src/app.module.ts")}\n${read("apps/mock-hub/src/app.module.ts")}`;
    expect(apps).not.toMatch(dynamicLoading);
    expect(apps).not.toMatch(/@awp\/connector-gitlab(?:-persistence-typeorm)?/u);
  });
});
