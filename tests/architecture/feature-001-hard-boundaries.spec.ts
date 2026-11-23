import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { dynamicRuntimeLoads } from "../support/runtime-code-loading.ts";

const root = resolve(import.meta.dirname, "../..");
async function sources(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? sources(path)
          : /\.(?:ts|tsx|mts)$/u.test(entry.name)
            ? [path]
            : [];
      }),
    )
  ).flat();
}
async function combined(directory: string): Promise<string> {
  return (
    await Promise.all((await sources(directory)).map(async (file) => await readFile(file, "utf8")))
  ).join("\n");
}

describe("Feature 001 hard implementation boundaries", () => {
  it("keeps the Feature 001 generic kernel QA-free and vendor-neutral as additive Connectors arrive", async () => {
    const generic = [
      "packages/platform-core/src",
      "packages/platform-runtime-nest/src",
      "packages/platform-persistence-typeorm/src",
      "packages/competency-dummy/src",
    ];
    const genericText = (
      await Promise.all(generic.map(async (path) => await combined(resolve(root, path))))
    ).join("\n");
    expect(genericText).not.toMatch(
      /@awp\/competency-qa|(?:^|["'])\.\.\/.*competency-qa|packages\/competency-qa/imu,
    );
    const vendorNeutral = [
      "packages/platform-core/src",
      "packages/platform-runtime-nest/src",
      "packages/platform-persistence-typeorm/src",
      "packages/connector-sdk/src",
      "packages/competency-sdk/src",
      "packages/competency-dummy/src",
    ];
    const vendorNeutralText = (
      await Promise.all(vendorNeutral.map(async (path) => await combined(resolve(root, path))))
    ).join("\n");
    expect(vendorNeutralText).not.toMatch(
      /@awp\/connector-(?:jira|gitlab|mattermost)|(?:jira|gitlab|mattermost)\/(?:api|rest|sdk)\b/iu,
    );
  });

  it("forbids Pack↔Connector imports and remote/dynamic runtime code loading", async () => {
    const [pack, connector, runtime] = await Promise.all([
      combined(resolve(root, "packages/competency-dummy/src")),
      combined(resolve(root, "packages/connector-mock/src")),
      combined(resolve(root, "packages")),
    ]);
    expect(pack).not.toMatch(/@awp\/connector-/u);
    expect(connector).not.toMatch(/@awp\/competency-/u);
    expect(runtime).not.toMatch(
      /\beval\s*\(|\bnew\s+Function\s*\(|https?:\/\/[^\s"']+\.(?:m?js)(?:[?#]|["'])/u,
    );
    expect(dynamicRuntimeLoads(runtime)).toEqual([]);
    expect(runtime).not.toMatch(/(?:npm|pnpm)\s+(?:install|add)\b/u);
  });

  it("distinguishes import methods from computed or remote runtime imports", () => {
    expect(
      dynamicRuntimeLoads(
        'class Importer { import(input: unknown) {} }; await import("./local.ts");',
      ),
    ).toEqual([]);
    expect(
      dynamicRuntimeLoads(
        [
          "await import(path); await import(`./",
          "$",
          '{path}`); await import("https://example.test/module.js");',
        ].join(""),
      ),
    ).toHaveLength(3);
  });

  it("keeps Core logicalRole opaque without branches on Pack-owned literals", async () => {
    const core = await combined(resolve(root, "packages/platform-core/src"));
    expect(core).not.toMatch(
      /(?:logicalRole|logical_role)[^\n]*(?:PRIMARY|SECONDARY|FUTURE_PACK_ROLE|QA_REQUEST_AUTHORITY)/u,
    );
    expect(core).not.toMatch(/case\s+["'][A-Z][A-Z0-9_.-]+["'][^\n]*logical/iu);
  });
});
