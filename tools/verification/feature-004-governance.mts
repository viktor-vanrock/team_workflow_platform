import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyPortableJson } from "./portable-json.mts";

export interface Feature004GovernanceDocumentRequirement {
  readonly path: string;
  readonly sha256: string;
}

export interface Feature004GovernanceManifest {
  readonly schemaVersion: 1;
  readonly acceptedAdr: Feature004GovernanceDocumentRequirement;
  readonly partiallySupersededAdr: Feature004GovernanceDocumentRequirement;
  readonly constitution: Feature004GovernanceDocumentRequirement & Readonly<{ version: "2.0.0" }>;
}

export interface Feature004GovernanceCheck {
  readonly id: "adr-0008" | "adr-0005" | "constitution";
  readonly status: "PASS" | "FAIL";
  readonly code: string;
  readonly detail: string;
}

export interface Feature004GovernanceBinding {
  readonly status: "PASS" | "FAIL";
  readonly checks: readonly Feature004GovernanceCheck[];
}

const workspace = resolve(import.meta.dirname, "../..");
const outputPath = "reports/004-mattermost-hermes-intake/governance.json";

export const FEATURE_004_GOVERNANCE_MANIFEST: Feature004GovernanceManifest = Object.freeze({
  schemaVersion: 1,
  acceptedAdr: Object.freeze({
    path: "docs/adr/0008-agent-run-subject-union.md",
    sha256: "sha256:efb0fcfcf983355d7a3f279221ed5333e1975fb8b8965a82cfb4be733fbe38ad",
  }),
  partiallySupersededAdr: Object.freeze({
    path: "docs/adr/0005-hermes-coordinator-approval.md",
    sha256: "sha256:8779c598e1d90207257fad00ebfd164fd1602ee866eaaa69ee15575de93440d2",
  }),
  constitution: Object.freeze({
    path: ".specify/memory/constitution.md",
    sha256: "sha256:d448f4586b3d798e9fd27a44471d9ad5ad1a6852db4b5255b6ee1d8c7ea7630f",
    version: "2.0.0",
  }),
});

function pass(id: Feature004GovernanceCheck["id"], detail: string): Feature004GovernanceCheck {
  return Object.freeze({ id, status: "PASS", code: "GOVERNANCE_DOCUMENT_ACCEPTED", detail });
}

function fail(
  id: Feature004GovernanceCheck["id"],
  code: string,
  detail: string,
): Feature004GovernanceCheck {
  return Object.freeze({ id, status: "FAIL", code, detail });
}

function digest(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safePath(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}/`))
    throw new Error(`Path escapes workspace: ${path}`);
  return target;
}

function readExact(
  root: string,
  id: Feature004GovernanceCheck["id"],
  requirement: Feature004GovernanceDocumentRequirement,
): Readonly<{ bytes?: string; check?: Feature004GovernanceCheck }> {
  let path: string;
  try {
    path = safePath(root, requirement.path);
  } catch (error) {
    return {
      check: fail(
        id,
        "GOVERNANCE_PATH_INVALID",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  if (!existsSync(path))
    return { check: fail(id, "GOVERNANCE_DOCUMENT_MISSING", `${requirement.path} is missing`) };
  const bytes = readFileSync(path, "utf8");
  const actual = digest(bytes);
  if (actual !== requirement.sha256)
    return {
      check: fail(
        id,
        "GOVERNANCE_DIGEST_MISMATCH",
        `${requirement.path} sha256=${actual}; expected=${requirement.sha256}`,
      ),
    };
  return { bytes };
}

export function verifyFeature004GovernanceBinding(
  root: string,
  manifest: Feature004GovernanceManifest = FEATURE_004_GOVERNANCE_MANIFEST,
): Feature004GovernanceBinding {
  const adr8 = readExact(root, "adr-0008", manifest.acceptedAdr);
  const adr5 = readExact(root, "adr-0005", manifest.partiallySupersededAdr);
  const constitution = readExact(root, "constitution", manifest.constitution);
  const checks: Feature004GovernanceCheck[] = [];

  if (adr8.check) checks.push(adr8.check);
  else if (!/\*\*Status:\*\*\s*Accepted\b/u.test(adr8.bytes ?? ""))
    checks.push(fail("adr-0008", "ADR_0008_NOT_ACCEPTED", "ADR-0008 status must be Accepted"));
  else if (!/\*\*Partially supersedes:\*\*\s*ADR-0005 Decision 1 only\b/u.test(adr8.bytes ?? ""))
    checks.push(
      fail(
        "adr-0008",
        "ADR_0008_PARTIAL_SUPERSESSION_INVALID",
        "ADR-0008 must supersede ADR-0005 Decision 1 only",
      ),
    );
  else if (
    !/(?:DRAFT[\s\S]*CANDIDATE[\s\S]*WORK_ITEM)|(?:`DRAFT \| CANDIDATE \| WORK_ITEM`)/u.test(
      adr8.bytes ?? "",
    )
  )
    checks.push(
      fail(
        "adr-0008",
        "ADR_0008_SUBJECT_UNION_MISSING",
        "ADR-0008 must define the closed DRAFT | CANDIDATE | WORK_ITEM union",
      ),
    );
  else checks.push(pass("adr-0008", `${manifest.acceptedAdr.path} ${manifest.acceptedAdr.sha256}`));

  if (adr5.check) checks.push(adr5.check);
  else if (!/Accepted[^\n]*Decision 1 partially superseded by ADR-0008/iu.test(adr5.bytes ?? ""))
    checks.push(
      fail(
        "adr-0005",
        "ADR_0005_PARTIAL_SUPERSESSION_MISSING",
        "ADR-0005 must remain Accepted with only Decision 1 partially superseded by ADR-0008",
      ),
    );
  else
    checks.push(
      pass(
        "adr-0005",
        `${manifest.partiallySupersededAdr.path} ${manifest.partiallySupersededAdr.sha256}`,
      ),
    );

  if (constitution.check) checks.push(constitution.check);
  else {
    const bytes = constitution.bytes ?? "";
    const compatible =
      bytes.includes(`**Версия:** ${manifest.constitution.version}`) &&
      /\*\*Статус:\*\*\s*Ratified\b/u.test(bytes) &&
      bytes.includes("DRAFT") &&
      bytes.includes("CANDIDATE") &&
      bytes.includes("WORK_ITEM");
    checks.push(
      compatible
        ? pass("constitution", `${manifest.constitution.path} ${manifest.constitution.sha256}`)
        : fail(
            "constitution",
            "CONSTITUTION_INCOMPATIBLE",
            `Constitution must be Ratified ${manifest.constitution.version} and contain the closed subject union`,
          ),
    );
  }

  return Object.freeze({
    status: checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    checks: Object.freeze(checks),
  });
}

function run(): void {
  const startedAt = new Date();
  const result = verifyFeature004GovernanceBinding(workspace);
  const report = {
    schemaVersion: 1,
    feature: "004-mattermost-hermes-intake",
    gate: "feature-004-governance",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    manifest: FEATURE_004_GOVERNANCE_MANIFEST,
    ...result,
  };
  const target = safePath(workspace, outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringifyPortableJson(report, workspace), "utf8");
  console.table(result.checks);
  console.log(`[governance:004] ${result.status}; report: ${target}`);
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
