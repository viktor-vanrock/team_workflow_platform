import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { verifyReviewedSdkDependencies008 } from "./feature-008-dependencies.mts";
import { BASELINE_007_HASH, hashBytes, ROOT_008, safeFile } from "./feature-008-prerequisites.mts";
import { type GateReport008, readGateReport008 } from "./feature-008-reports.mts";

// Entry is historical evidence. Subsequent checkpoints verify current source independently.
export const ENTRY_SETUP_008 = Object.freeze({
  path: "reports/008-pilot-hardening-and-conformance/runs/setup-890815e5-3285-4ba8-af0a-db00e0cf1ed5.json",
  sha256: "sha256:df4d2adaf2457c90b5a75757ddbe224045fd43880944b617224e63163208c831",
});
export function verifyEntryAndPublishedHistory008(root = ROOT_008): Readonly<{
  status: "PASS" | "FAIL";
  reasonCodes: string[];
  publishedFiles: number;
  entry: typeof ENTRY_SETUP_008;
}> {
  const reasonCodes: string[] = [];
  let publishedFiles = 0;
  try {
    const manifestBytes = readFileSync(safeFile(root, "config/pilot/feature-007-baseline.json"));
    if (hashBytes(manifestBytes) !== BASELINE_007_HASH) throw new Error("ENTRY_MANIFEST_TAMPERED");
    const baseline = JSON.parse(manifestBytes.toString()) as { commit: string };
    const reportBytes = readFileSync(safeFile(root, ENTRY_SETUP_008.path));
    if (hashBytes(reportBytes) !== ENTRY_SETUP_008.sha256) throw new Error("ENTRY_REPORT_TAMPERED");
    const report = JSON.parse(reportBytes.toString()) as GateReport008;
    const validated = readGateReport008(root, ENTRY_SETUP_008, {
      now: Date.now(),
      maximumAgeMs: 7 * 24 * 3600_000,
      scope: { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] },
      fingerprints: report.fingerprints,
      allowedExecutors: ["local-cli"],
    });
    if (
      validated.gate !== "setup" ||
      validated.status !== "PASS" ||
      validated.checks.length !== 9 ||
      validated.checks.some((check) => check.status !== "PASS")
    )
      throw new Error("ENTRY_NOT_PASS");
    const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline.commit], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 5_000_000,
    })
      .trim()
      .split("\n")
      .filter(
        (path) =>
          /^specs\/00[1-7]-[^/]+\/contracts\//u.test(path) ||
          (/^packages\/.+\/migrations\//u.test(path) && /\/\d[^/]+\.ts$/u.test(path)) ||
          ["pnpm-lock.yaml", ".node-version"].includes(path),
      );
    if (paths.length < 100) throw new Error("HISTORICAL_INVENTORY_INCOMPLETE");
    const historicalBytes = execFileSync("git", ["cat-file", "--batch"], {
      cwd: root,
      input: paths.map((path) => `${baseline.commit}:${path}\n`).join(""),
      maxBuffer: 50_000_000,
    });
    let offset = 0;
    for (const path of paths) {
      const end = historicalBytes.indexOf(10, offset);
      const header = historicalBytes
        .subarray(offset, end)
        .toString("ascii")
        .match(/^[a-f0-9]+ blob (\d+)$/u);
      if (end < offset || !header) throw new Error("HISTORICAL_OBJECT_INVALID");
      const length = Number(header[1]);
      if (!Number.isSafeInteger(length) || length < 0 || end + 1 + length >= historicalBytes.length)
        throw new Error("HISTORICAL_OBJECT_INVALID");
      const expected = historicalBytes.subarray(end + 1, end + 1 + length);
      offset = end + 2 + length;
      const current = readFileSync(safeFile(root, path));
      if (!current.equals(expected)) {
        if (path === "pnpm-lock.yaml") verifyReviewedSdkDependencies008(root, expected, current);
        else reasonCodes.push(`PUBLISHED_HISTORY_CHANGED:${path}`);
      }
      publishedFiles++;
    }
    if (offset !== historicalBytes.length) throw new Error("HISTORICAL_OBJECT_INVALID");
  } catch (error) {
    reasonCodes.push(
      error instanceof Error && /^[A-Z_]+$/u.test(error.message)
        ? error.message
        : "ENTRY_OR_HISTORY_UNVERIFIED",
    );
  }
  return {
    status: reasonCodes.length ? "FAIL" : "PASS",
    reasonCodes,
    publishedFiles,
    entry: ENTRY_SETUP_008,
  };
}
