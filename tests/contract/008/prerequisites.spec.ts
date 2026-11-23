import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  hashBytes,
  type UpstreamFiles,
  verifyUpstreamFiles,
} from "../../../tools/verification/feature-008-prerequisites.mts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awp-008-prereq-"));
  roots.push(root);
  const files = {
    "packages/core/src/model.ts": "export const value = 1;\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const baseline: UpstreamFiles = {
    files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, hashBytes(b)])),
    roots: ["packages/core/src"],
    packageJson: {},
  };
  return { root, baseline };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("008 upstream source binding", () => {
  it("rehashes current source and lockfile bytes", () => {
    const { root, baseline } = fixture();
    expect(verifyUpstreamFiles(root, baseline)).toEqual([]);
    writeFileSync(join(root, "packages/core/src/model.ts"), "changed");
    expect(verifyUpstreamFiles(root, baseline)).toContain(
      "UPSTREAM_FILE_CHANGED:packages/core/src/model.ts",
    );
  });
  it("rejects missing files and untracked upstream source", () => {
    const { root, baseline } = fixture();
    rmSync(join(root, "pnpm-lock.yaml"));
    writeFileSync(join(root, "packages/core/src/untracked.ts"), "unknown");
    expect(verifyUpstreamFiles(root, baseline)).toEqual(
      expect.arrayContaining([
        "UPSTREAM_FILE_MISSING:pnpm-lock.yaml",
        "UNBOUND_UPSTREAM_FILE:packages/core/src/untracked.ts",
      ]),
    );
  });
  it("rejects symlink substitution and path escape", () => {
    const { root, baseline } = fixture();
    const p = join(root, "packages/core/src/model.ts");
    rmSync(p);
    symlinkSync(join(root, "pnpm-lock.yaml"), p);
    expect(verifyUpstreamFiles(root, baseline)).toContain(
      "UPSTREAM_PATH_UNSAFE:packages/core/src/model.ts",
    );
    expect(
      verifyUpstreamFiles(root, { ...baseline, files: { "../outside": hashBytes("x") } }),
    ).toContain("UPSTREAM_PATH_UNSAFE:../outside");
  });
  it("does not excuse modified existing verification tools", () => {
    const { root, baseline } = fixture();
    const p = "tools/verification/feature-007-gate.mts";
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), "old");
    const extended = { ...baseline, files: { ...baseline.files, [p]: hashBytes("old") } };
    writeFileSync(join(root, p), "new");
    expect(verifyUpstreamFiles(root, extended)).toContain(`UPSTREAM_FILE_CHANGED:${p}`);
  });
  it("permits only explicitly named new 008 verification files", () => {
    const { root, baseline } = fixture();
    const folder = join(root, "tools/verification");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "feature-008-reports.mts"), "new");
    expect(
      verifyUpstreamFiles(root, { ...baseline, roots: [...baseline.roots, "tools/verification"] }),
    ).toEqual([]);
    writeFileSync(join(folder, "bypass.mts"), "new");
    expect(
      verifyUpstreamFiles(root, { ...baseline, roots: [...baseline.roots, "tools/verification"] }),
    ).toContain("UNBOUND_UPSTREAM_FILE:tools/verification/bypass.mts");
  });
  it("detects tampering even when a file still contains expected tokens", () => {
    const { root, baseline } = fixture();
    const p = join(root, "packages/core/src/model.ts");
    writeFileSync(p, readFileSync(p, "utf8") + "// unsafe change");
    expect(verifyUpstreamFiles(root, baseline).length).toBeGreaterThan(0);
  });
});
