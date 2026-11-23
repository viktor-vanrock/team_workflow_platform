import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { parse } from "yaml";

import { hashBytes, safeFile } from "./feature-008-prerequisites.mts";

const REVIEW_PATH = "config/pilot/otel-dependency-review.json";
const REVIEW_HASH = "sha256:a204872dc3c498b7a40359a0d9dc752b2b6a1b66f3947d8e6744ec81e804a5a6";
const REMEDIATION_PATH = "config/pilot/local-audit-dependency-review.json";
const REMEDIATION_HASH = "sha256:60f9afce0f2a2dc7cd5f96113a79a906430095b70da2a4ecb18b138ca94f9910";
const WORKSPACE_ADDITIONS_HASH =
  "sha256:6b42f43a56a2523110495f230cebeca1aa7c8b02a023df150205762cf372d355";
export interface DependencyReview008 {
  schemaVersion: 1;
  baselineLockHash: string;
  lockHash: string;
  importer: string;
  directDependencies: Record<string, { specifier: string; version: string }>;
  addedPackages: string[];
  addedSnapshots: string[];
  audit: { path: string; sha256: string };
  remediations?: { path: string[]; before?: unknown; after?: unknown }[];
  qualityDevDependencies?: Record<string, { specifier: string; version: string }>;
  qualityAddedPackagesHash?: string;
  qualityAddedSnapshotsHash?: string;
  workspaceImporterAdditions?: Record<string, { dependencies: Record<string, unknown> }>;
  v1DependencyRemovals?: {
    catalogs: string[];
    importers: string[];
    packages: string[];
    snapshots: string[];
  };
}
interface Lock {
  catalogs: { default: Record<string, unknown> };
  packages: Record<string, unknown>;
  snapshots: Record<string, unknown>;
  importers: Record<
    string,
    {
      dependencies: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    }
  >;
}

const expectedV1DependencyRemovals = Object.freeze({
  catalogs: Object.freeze(["@nestjs/bullmq", "bullmq"]),
  importers: Object.freeze(["packages/platform-queue-bullmq"]),
  packages: Object.freeze([
    "@msgpackr-extract/msgpackr-extract-darwin-arm64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-darwin-x64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-arm64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-arm@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-x64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-win32-x64@3.0.4",
    "@nestjs/bull-shared@11.0.5",
    "@nestjs/bullmq@11.0.5",
    "bullmq@6.3.1",
    "cron-parser@5.10.0",
    "luxon@3.7.2",
    "msgpackr-extract@3.0.4",
    "msgpackr@2.0.5",
    "node-abort-controller@3.1.1",
    "node-gyp-build-optional-packages@5.2.2",
  ]),
  snapshots: Object.freeze([
    "@msgpackr-extract/msgpackr-extract-darwin-arm64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-darwin-x64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-arm64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-arm@3.0.4",
    "@msgpackr-extract/msgpackr-extract-linux-x64@3.0.4",
    "@msgpackr-extract/msgpackr-extract-win32-x64@3.0.4",
    "@nestjs/bull-shared@11.0.5(@nestjs/common@11.2.3(reflect-metadata@0.2.2)(rxjs@7.8.2)(supports-color@7.2.0))(@nestjs/core@11.2.3)",
    "@nestjs/bullmq@11.0.5(@nestjs/common@11.2.3(reflect-metadata@0.2.2)(rxjs@7.8.2)(supports-color@7.2.0))(@nestjs/core@11.2.3)(bullmq@6.3.1(pg@8.23.0))",
    "bullmq@6.3.1(pg@8.23.0)",
    "cron-parser@5.10.0",
    "luxon@3.7.2",
    "msgpackr-extract@3.0.4",
    "msgpackr@2.0.5",
    "node-abort-controller@3.1.1",
    "node-gyp-build-optional-packages@5.2.2",
  ]),
});

/** Prune only explicitly reviewed additions, then compare the entire old lock. */
export function assertReviewedLockAddition008(
  beforeBytes: Buffer,
  currentBytes: Buffer,
  review: DependencyReview008,
): void {
  if (
    review.schemaVersion !== 1 ||
    review.importer !== "packages/platform-runtime-nest" ||
    review.baselineLockHash !== hashBytes(beforeBytes) ||
    review.lockHash !== hashBytes(currentBytes)
  )
    throw new Error("DEPENDENCY_REVIEW_MISMATCH");
  const before = parse(beforeBytes.toString()) as Lock;
  const after = parse(currentBytes.toString()) as Lock;
  if (review.workspaceImporterAdditions !== undefined) {
    // These additions link the local documentation pack and reuse already locked packages.
    // Pin the complete additions, then retain the full baseline comparison below.
    if (hashBytes(JSON.stringify(review.workspaceImporterAdditions)) !== WORKSPACE_ADDITIONS_HASH)
      throw new Error("DEPENDENCY_WORKSPACE_REVIEW_INVALID");
    for (const [importer, additions] of Object.entries(review.workspaceImporterAdditions)) {
      const next = after.importers[importer];
      if (!(importer in before.importers)) {
        if (!isDeepStrictEqual(next, additions))
          throw new Error("DEPENDENCY_WORKSPACE_REVIEW_INVALID");
        Reflect.deleteProperty(after.importers, importer);
        continue;
      }
      for (const [name, value] of Object.entries(additions.dependencies)) {
        if (
          name in before.importers[importer]!.dependencies ||
          !isDeepStrictEqual(next?.dependencies[name], value)
        )
          throw new Error("DEPENDENCY_WORKSPACE_REVIEW_INVALID");
        Reflect.deleteProperty(next!.dependencies, name);
      }
    }
  }
  const qualityMetadata = [
    review.qualityDevDependencies,
    review.qualityAddedPackagesHash,
    review.qualityAddedSnapshotsHash,
  ];
  if (qualityMetadata.some((value) => value !== undefined)) {
    if (
      !review.qualityDevDependencies ||
      !review.qualityAddedPackagesHash ||
      !review.qualityAddedSnapshotsHash
    )
      throw new Error("DEPENDENCY_QUALITY_REVIEW_INVALID");
    const rootDevDependencies = after.importers["."]?.devDependencies;
    if (!rootDevDependencies) throw new Error("DEPENDENCY_QUALITY_REVIEW_INVALID");
    for (const [name, value] of Object.entries(review.qualityDevDependencies)) {
      if (!isDeepStrictEqual(rootDevDependencies[name], value))
        throw new Error("DEPENDENCY_QUALITY_REVIEW_INVALID");
      Reflect.deleteProperty(rootDevDependencies, name);
    }
    for (const [key, expectedHash] of [
      ["packages", review.qualityAddedPackagesHash],
      ["snapshots", review.qualityAddedSnapshotsHash],
    ] as const) {
      const featureAdditions = new Set(
        key === "packages" ? review.addedPackages : review.addedSnapshots,
      );
      for (const remediation of review.remediations ?? []) {
        if (
          remediation.path[0] === key &&
          remediation.path.length === 2 &&
          !Object.hasOwn(remediation, "before")
        )
          featureAdditions.add(remediation.path[1]!);
      }
      const qualityAdditions = Object.keys(after[key])
        .filter((name) => !(name in before[key]) && !featureAdditions.has(name))
        .sort();
      if (hashBytes(JSON.stringify(qualityAdditions)) !== expectedHash)
        throw new Error("DEPENDENCY_QUALITY_REVIEW_INVALID");
      for (const name of qualityAdditions) Reflect.deleteProperty(after[key], name);
    }
  }
  const allowedRemediations = new Set(
    [
      ["overrides", "qs"],
      ["importers", ".", "devDependencies", "react-dom"],
      ["importers", ".", "devDependencies", "typeorm"],
      ["packages", "qs@6.15.3"],
      ["packages", "qs@6.16.0"],
      ["snapshots", "qs@6.15.3"],
      ["snapshots", "qs@6.16.0"],
      ["snapshots", "body-parser@2.3.0(supports-color@7.2.0)", "dependencies", "qs"],
      ["snapshots", "express@5.2.1(supports-color@7.2.0)", "dependencies", "qs"],
    ].map((path) => JSON.stringify(path)),
  );
  for (const change of review.remediations ?? []) {
    if (!allowedRemediations.delete(JSON.stringify(change.path)))
      throw new Error("DEPENDENCY_REMEDIATION_INVALID");
    let previous: Record<string, unknown> = before as unknown as Record<string, unknown>;
    let next: Record<string, unknown> = after as unknown as Record<string, unknown>;
    for (const key of change.path.slice(0, -1)) {
      if (
        !previous[key] ||
        typeof previous[key] !== "object" ||
        !next[key] ||
        typeof next[key] !== "object"
      )
        throw new Error("DEPENDENCY_REMEDIATION_INVALID");
      previous = previous[key] as Record<string, unknown>;
      next = next[key] as Record<string, unknown>;
    }
    const key = change.path.at(-1)!;
    if (
      !isDeepStrictEqual(previous[key], change.before) ||
      !isDeepStrictEqual(next[key], change.after)
    )
      throw new Error("DEPENDENCY_REMEDIATION_INVALID");
    if (Object.hasOwn(change, "before")) next[key] = change.before;
    else Reflect.deleteProperty(next, key);
  }
  if (review.v1DependencyRemovals !== undefined) {
    if (!isDeepStrictEqual(review.v1DependencyRemovals, expectedV1DependencyRemovals))
      throw new Error("DEPENDENCY_REMOVAL_REVIEW_INVALID");
    const sections = {
      catalogs: [before.catalogs.default, after.catalogs.default],
      importers: [before.importers, after.importers],
      packages: [before.packages, after.packages],
      snapshots: [before.snapshots, after.snapshots],
    } as const;
    for (const [section, names] of Object.entries(review.v1DependencyRemovals) as [
      keyof typeof sections,
      string[],
    ][]) {
      const [previous, next] = sections[section];
      for (const name of names) {
        if (!(name in previous) || name in next)
          throw new Error("DEPENDENCY_REMOVAL_REVIEW_INVALID");
        next[name] = previous[name];
      }
    }
  }
  for (const key of ["packages", "snapshots"] as const) {
    const additions = key === "packages" ? review.addedPackages : review.addedSnapshots;
    if (!additions.length || new Set(additions).size !== additions.length)
      throw new Error("DEPENDENCY_REVIEW_INVALID");
    for (const name of additions) {
      if (!/^@opentelemetry\/[a-z-]+@/u.test(name) || name in before[key] || !(name in after[key]))
        throw new Error("DEPENDENCY_ADDITION_INVALID");
      Reflect.deleteProperty(after[key], name);
    }
  }
  const previous = before.importers[review.importer]!.dependencies;
  const next = after.importers[review.importer]!.dependencies;
  for (const [name, value] of Object.entries(review.directDependencies)) {
    if (
      !name.startsWith("@opentelemetry/") ||
      name in previous ||
      !isDeepStrictEqual(next[name], value)
    )
      throw new Error("DEPENDENCY_ADDITION_INVALID");
    Reflect.deleteProperty(next, name);
  }
  if (!isDeepStrictEqual(before, after)) throw new Error("DEPENDENCY_BASELINE_CHANGED");
}

export function verifyReviewedSdkDependencies008(
  root: string,
  before: Buffer,
  current: Buffer,
): void {
  const bytes = readFileSync(safeFile(root, REVIEW_PATH));
  if (hashBytes(bytes) !== REVIEW_HASH) throw new Error("DEPENDENCY_REVIEW_TAMPERED");
  let review = JSON.parse(bytes.toString()) as DependencyReview008;
  if (hashBytes(current) !== review.lockHash) {
    const remediation = readFileSync(safeFile(root, REMEDIATION_PATH));
    if (hashBytes(remediation) !== REMEDIATION_HASH) throw new Error("DEPENDENCY_REVIEW_TAMPERED");
    review = JSON.parse(remediation.toString()) as DependencyReview008;
  }
  assertReviewedLockAddition008(before, current, review);
  const auditBytes = readFileSync(safeFile(root, review.audit.path));
  if (hashBytes(auditBytes) !== review.audit.sha256) throw new Error("DEPENDENCY_AUDIT_TAMPERED");
  const audit = JSON.parse(auditBytes.toString()) as {
    error?: unknown;
    metadata?: { dependencies?: number };
    advisories?: Record<string, { findings: { paths: string[] }[] }>;
  };
  if (
    audit.error ||
    !audit.metadata?.dependencies ||
    !audit.advisories ||
    Object.values(audit.advisories).some((entry) =>
      entry.findings.some((finding) =>
        finding.paths.some((path) => path.includes("@opentelemetry/")),
      ),
    )
  )
    throw new Error("DEPENDENCY_AUDIT_UNVERIFIED");
  if (review.remediations && Object.keys(audit.advisories).length)
    throw new Error("DEPENDENCY_REMEDIATION_AUDIT_NOT_CLEAN");
}
