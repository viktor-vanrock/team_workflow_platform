import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  gitLabCapabilitySurface,
  gitLabProhibitedOperations,
} from "../../packages/connector-gitlab/src/manifest.ts";

const root = resolve(import.meta.dirname, "../..");

async function files(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? files(path)
          : /\.(?:ts|tsx|mts)$/u.test(entry.name)
            ? [path]
            : [];
      }),
    )
  ).flat();
}

async function source(directory: string): Promise<string> {
  return (
    await Promise.all(
      (await files(resolve(root, directory))).map(async (file) => readFile(file, "utf8")),
    )
  ).join("\n");
}

const dynamicLoading =
  /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])/u;

describe("Feature 005 GitLab boundaries", () => {
  it("keeps Core, QA, generic runtime and browser code free of GitLab imports", async () => {
    for (const directory of [
      "packages/platform-core/src",
      "packages/connector-sdk/src",
      "packages/competency-qa/src",
      "packages/platform-runtime-nest/src",
      "apps/web/src",
    ]) {
      const content = await source(directory);
      expect(content, directory).not.toMatch(
        /@awp\/connector-gitlab|gitlab\/api\/v4|gitlab-rest/iu,
      );
    }
  });

  it("keeps the pure GitLab adapter provider-neutral above its own protocol and framework-free", async () => {
    const connector = await source("packages/connector-gitlab/src");
    expect(connector).not.toMatch(
      /typeorm|@awp\/platform-core|@awp\/competency-qa|@nestjs\/|react|@awp\/connector-mattermost/iu,
    );
    expect(connector).not.toMatch(dynamicLoading);
  });

  it("keeps GitLab persistence limited to adapter state and outside QA/Core ownership", async () => {
    const persistence = await source("packages/connector-gitlab-persistence-typeorm/src");
    expect(persistence).not.toMatch(
      /@awp\/platform-core|@awp\/competency-qa|@nestjs\/|react|@awp\/connector-mattermost/iu,
    );
    expect(persistence).not.toMatch(
      /qa_(?:test_sessions|plan_items|attempt_identities|automation_attempts|automation_suite)/iu,
    );
    expect(persistence).not.toMatch(dynamicLoading);
    const createdTables = [...persistence.matchAll(/CREATE TABLE\s+([a-z0-9_]+)/giu)].map(
      (match) => match[1],
    );
    expect(createdTables.length).toBeGreaterThan(0);
    expect(createdTables.every((table) => table?.startsWith("gitlab_"))).toBe(true);
  });

  it("contains no prohibited provider mutation vocabulary in exported GitLab operations", async () => {
    const implemented = gitLabCapabilitySurface.flatMap(({ operations }) => operations);
    expect(implemented).toEqual([
      "merge-request.read",
      "commit.read",
      "build.read",
      "pipeline.trigger",
      "pipeline.read",
      "pipeline.lookup",
      "artifact.metadata",
      "artifact.stream",
    ]);
    expect(
      implemented.filter((operation) =>
        (gitLabProhibitedOperations as readonly string[]).includes(operation),
      ),
    ).toEqual([]);
  });

  it("keeps the GitLab contour independent from Mattermost", async () => {
    const gitlab = `${await source("packages/connector-gitlab/src")}\n${await source("packages/connector-gitlab-persistence-typeorm/src")}\n${await source("packages/runtime-composition/src/gitlab")}`;
    expect(gitlab).not.toMatch(/@awp\/connector-mattermost|mattermost/iu);
    expect(gitlab).not.toMatch(dynamicLoading);
  });
});
