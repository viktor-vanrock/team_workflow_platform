import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  qaSessionModes,
  qaValidationWorkTypeDefinition,
} from "../../packages/competency-qa/src/manifest.ts";

const root = resolve(import.meta.dirname, "../..");

async function sources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.(?:ts|tsx|mts)$/u.test(entry.name) ? [path] : [];
      }),
    )
  ).flat();
}

async function combined(directory: string): Promise<string> {
  return (
    await Promise.all((await sources(directory)).map(async (file) => await readFile(file, "utf8")))
  ).join("\n");
}

describe("Feature 002 QA Pack architecture boundaries", () => {
  it("keeps the Core-only build independent from QA", async () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/nx/dist/bin/nx.js", "run", "platform-core:core-build", "--skip-nx-cache"],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/competency-qa|domain:qa/iu);
    expect(result.status).toBe(0);

    const core = await combined(resolve(root, "packages/platform-core/src"));
    expect(core).not.toMatch(
      /@awp\/competency-qa|qa\.validation|QA_REQUEST_AUTHORITY|DEFECT_DESTINATION/u,
    );
  });

  it("forbids QA dependencies on provider implementations, Nest and provider-specific APIs", async () => {
    const qa = await combined(resolve(root, "packages/competency-qa/src"));
    expect(qa).not.toMatch(
      /@awp\/connector-|@nestjs\/|jql|customfield_|transitionId|gitlab\/api|mattermost\/api/iu,
    );

    const packageJson = JSON.parse(
      await readFile(resolve(root, "packages/competency-qa/package.json"), "utf8"),
    ) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@awp/competency-sdk",
      "@awp/competency-ui-sdk",
      "@awp/platform-contracts",
      "@awp/platform-ui",
      "react",
      "typeorm",
    ]);
  });

  it("keeps the published Feature 002 V1 manifest and manual Attempt files MANUAL-only", async () => {
    expect(qaSessionModes).toEqual(["MANUAL"]);
    const historicalV1 = `${JSON.stringify(qaValidationWorkTypeDefinition)}\n${await readFile(resolve(root, "packages/competency-qa/src/domain/manual-attempt.ts"), "utf8")}`;
    expect(historicalV1).not.toMatch(/\bAUTOMATED\b|executeAutomated|AutomatedExecutor/iu);
  });

  it("contains no runtime code loading anywhere in the Pack", async () => {
    const qa = await combined(resolve(root, "packages/competency-qa/src"));
    expect(qa).not.toMatch(
      /\beval\s*\(|\bnew\s+Function\s*\(|\bcreateRequire\s*\(|\brequire\s*\(|import\s*\(\s*(?:`|[^"'])|https?:\/\/[^\s"']+\.(?:m?js)(?:[?#]|["'])/u,
    );
  });
});
