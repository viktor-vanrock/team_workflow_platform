import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FEATURE_008 = "008-pilot-hardening-and-conformance";
export const ROOT_008 = resolve(import.meta.dirname, "../..");
export const BASELINE_007_HASH =
  "sha256:5c865d1dfda360610deb971a54c7515fa4e7cc5323f515d17148d357ad67c81d";
export interface UpstreamFiles {
  readonly files: Readonly<Record<string, string>>;
  readonly roots: readonly string[];
  readonly packageJson: Readonly<Record<string, unknown>>;
}
export interface UpstreamBaseline {
  readonly schemaVersion: number;
  readonly feature: string;
  readonly commit: string;
  readonly report: { readonly path: string; readonly sha256: string };
  readonly evidence: { readonly path: string; readonly sha256: string };
  readonly files: Readonly<Record<string, string>>;
  readonly groups: Readonly<
    Record<
      string,
      {
        readonly roots: readonly string[];
        readonly files: readonly string[];
        readonly sha256: string;
      }
    >
  >;
  readonly lockfile: { readonly path: string; readonly sha256: string };
  readonly packageJson: Readonly<Record<string, unknown>>;
}
export function hashBytes(bytes: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function safeFile(root: string, path: string, mustExist = true): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "." || !part)
  )
    throw new Error("PATH_UNSAFE");
  const base = realpathSync(root),
    target = resolve(base, path);
  if (!target.startsWith(`${base}/`)) throw new Error("PATH_UNSAFE");
  let part = base;
  for (const segment of path.split("/")) {
    part = resolve(part, segment);
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error("PATH_UNSAFE");
  }
  if (mustExist && !existsSync(target)) throw new Error("FILE_MISSING");
  return target;
}
export function filesBelow(root: string, path: string): string[] {
  const absolute = safeFile(root, path);
  if (lstatSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git"].includes(entry.name)) return [];
    const child = `${path}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`PATH_UNSAFE:${child}`);
    return entry.isDirectory() ? filesBelow(root, child) : entry.isFile() ? [child] : [];
  });
}
export function treeHash(root: string, paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...new Set(paths.flatMap((p) => filesBelow(root, p)))].sort())
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(safeFile(root, path)))
      .update("\0");
  return `sha256:${hash.digest("hex")}`;
}
function packageOnlyAdds008Scripts(
  value: unknown,
  baseline: Readonly<Record<string, unknown>>,
): boolean {
  if (!record(value) || !record(value.scripts) || !record(baseline.scripts)) return false;
  const scripts = { ...value.scripts };
  for (const [name, command] of Object.entries(scripts)) {
    if (Object.hasOwn(baseline.scripts, name)) continue;
    if (
      !/(?:^|:)008(?::|$)/u.test(name) ||
      typeof command !== "string" ||
      !/^node tools\/(?:verification|ci|smoke)\/[\w-]*008[\w-]*\.mts(?: [\w:/.-]+)*$/u.test(command)
    )
      return false;
  }
  return (
    JSON.stringify({
      ...value,
      scripts: Object.fromEntries(
        Object.entries(scripts).filter(([name]) => Object.hasOwn(baseline.scripts as object, name)),
      ),
    }) === JSON.stringify(baseline)
  );
}
export function verifyUpstreamFiles(root: string, baseline: UpstreamFiles): string[] {
  const errors: string[] = [];
  for (const [path, expected] of Object.entries(baseline.files)) {
    let target: string;
    try {
      target = safeFile(root, path);
    } catch (error) {
      errors.push(
        `${error instanceof Error && error.message === "FILE_MISSING" ? "UPSTREAM_FILE_MISSING" : "UPSTREAM_PATH_UNSAFE"}:${path}`,
      );
      continue;
    }
    const bytes = readFileSync(target);
    if (hashBytes(bytes) === expected) continue;
    if (path === "package.json") {
      try {
        if (
          packageOnlyAdds008Scripts(
            JSON.parse(bytes.toString("utf8")) as unknown,
            baseline.packageJson,
          )
        )
          continue;
      } catch {
        /* invalid package is a mismatch */
      }
    }
    errors.push(`UPSTREAM_FILE_CHANGED:${path}`);
  }
  for (const path of baseline.roots) {
    try {
      for (const child of filesBelow(root, path)) {
        if (
          !Object.hasOwn(baseline.files, child) &&
          !/^tools\/verification\/(?:feature-008-|008-)[\w-]+\.mts$/u.test(child)
        )
          errors.push(`UNBOUND_UPSTREAM_FILE:${child}`);
      }
    } catch {
      errors.push(`UPSTREAM_ROOT_UNSAFE:${path}`);
    }
  }
  return [...new Set(errors)].sort();
}
export function verifyFeature008Prerequisites(
  root = ROOT_008,
  now = Date.now(),
): Readonly<{
  status: "PASS" | "FAIL";
  reasonCodes: readonly string[];
  baselineCommit?: string;
  baselineManifestHash?: string;
  upstreamReportHash?: string;
  verifiedFiles?: number;
  checkedAt: string;
}> {
  const errors: string[] = [];
  try {
    const baselineBytes = readFileSync(safeFile(root, "config/pilot/feature-007-baseline.json"));
    if (hashBytes(baselineBytes) !== BASELINE_007_HASH)
      throw new Error("BASELINE_MANIFEST_TAMPERED");
    const baseline = JSON.parse(baselineBytes.toString("utf8")) as UpstreamBaseline;
    const readBound = (ref: {
      readonly path: string;
      readonly sha256: string;
    }): Record<string, unknown> => {
      const bytes = readFileSync(safeFile(root, ref.path));
      if (hashBytes(bytes) !== ref.sha256) throw new Error("UPSTREAM_REPORT_DIGEST_MISMATCH");
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!record(value)) throw new Error("UPSTREAM_REPORT_INVALID");
      return value;
    };
    const final = readBound(baseline.report),
      evidence = readBound(baseline.evidence);
    for (const report of [final, evidence]) {
      if (
        report.schemaVersion !== 1 ||
        report.feature !== baseline.feature ||
        report.status !== "PASS" ||
        report.production !== "DENIED"
      )
        errors.push("UPSTREAM_REPORT_INCOMPATIBLE");
      const time = Date.parse(String(report.finishedAt ?? ""));
      if (!Number.isFinite(time) || time > now + 60_000 || now - time > 604_800_000)
        errors.push("UPSTREAM_REPORT_STALE");
    }
    if (
      final.gate !== "feature-007-final" ||
      final.deploymentApproval !== "LOCAL_CONFORMANCE_ONLY" ||
      !record(final.evidence) ||
      final.evidence.sha256 !== baseline.evidence.sha256
    )
      errors.push("UPSTREAM_FINAL_BINDING_INVALID");
    if (
      !Array.isArray(final.stages) ||
      final.stages.length !== 27 ||
      final.stages.some((s: unknown) => !record(s) || s.status !== "PASS")
    )
      errors.push("UPSTREAM_STAGE_NOT_PASS");
    const snapshots = record(evidence.snapshots) ? evidence.snapshots : undefined;
    if (
      !snapshots ||
      !record(snapshots.tasks) ||
      !Array.isArray(snapshots.tasks.pendingTaskIds) ||
      snapshots.tasks.pendingTaskIds.length !== 0
    )
      errors.push("UPSTREAM_TASKS_PENDING");
    if (!Array.isArray(evidence.childReports) || evidence.childReports.length !== 24)
      errors.push("UPSTREAM_CHILDREN_INVALID");
    else
      for (const child of evidence.childReports) {
        if (!record(child) || typeof child.name !== "string" || typeof child.sha256 !== "string") {
          errors.push("UPSTREAM_CHILD_INVALID");
          continue;
        }
        const value = readBound({
          path: `reports/${baseline.feature}/${child.name}`,
          sha256: child.sha256,
        });
        if (value.status !== "PASS" || value.feature !== baseline.feature)
          errors.push(`UPSTREAM_CHILD_NOT_PASS:${child.name}`);
        const timestamp = Date.parse(
          String(value.finishedAt ?? value.generatedAt ?? value.startedAt ?? ""),
        );
        if (
          !Number.isFinite(timestamp) ||
          timestamp > now + 60_000 ||
          now - timestamp > 604_800_000
        )
          errors.push(`UPSTREAM_CHILD_STALE:${child.name}`);
      }
    for (const [name, group] of Object.entries(baseline.groups)) {
      const old = snapshots?.[name];
      if (!record(old) || old.sha256 !== group.sha256 || old.fileCount !== group.files.length)
        errors.push(`UPSTREAM_SNAPSHOT_INVALID:${name}`);
    }
    errors.push(
      ...verifyUpstreamFiles(root, {
        files: { ...baseline.files, [baseline.lockfile.path]: baseline.lockfile.sha256 },
        roots: [...new Set(Object.values(baseline.groups).flatMap((g) => g.roots))],
        packageJson: baseline.packageJson,
      }),
    );
    return {
      status: errors.length ? "FAIL" : "PASS",
      reasonCodes: [...new Set(errors)],
      baselineCommit: baseline.commit,
      baselineManifestHash: hashBytes(baselineBytes),
      upstreamReportHash: baseline.report.sha256,
      verifiedFiles: Object.keys(baseline.files).length,
      checkedAt: new Date(now).toISOString(),
    };
  } catch (error) {
    return {
      status: "FAIL",
      reasonCodes: [...errors, error instanceof Error ? error.message : "UPSTREAM_CHECK_FAILED"],
      checkedAt: new Date(now).toISOString(),
    };
  }
}
export function write008Json(path: string, value: unknown, root = ROOT_008): void {
  const target = safeFile(root, path, false);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).filter((x) => x !== "--").length)
    throw new Error("UNKNOWN_PREREQUISITE_ARGUMENT");
  const result = verifyFeature008Prerequisites();
  write008Json(`reports/${FEATURE_008}/entry-baseline.json`, result);
  console.log(
    `[verify:008:prerequisites] ${result.status}; files=${result.verifiedFiles ?? 0}; ${result.reasonCodes.join(", ")}`,
  );
  if (result.status !== "PASS") process.exitCode = 1;
}
