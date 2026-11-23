import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ROOT_008 } from "./feature-008-prerequisites.mts";

export const COMMANDS_008 = Object.freeze({
  prerequisites: {
    script: "verify:008:prerequisites",
    path: "tools/verification/feature-008-prerequisites.mts",
  },
  setup: { script: "verify:008:setup", path: "tools/verification/008-setup-gate.mts" },
  foundation: {
    script: "verify:008:foundation",
    path: "tools/verification/008-foundation-checkpoint.mts",
  },
  us1: { script: "verify:008:us1", path: "tools/verification/008-us1-checkpoint.mts" },
  us2: { script: "verify:008:us2", path: "tools/verification/008-us2-checkpoint.mts" },
  hermes: { script: "verify:008:hermes", path: "tools/verification/008-hermes-evaluation.mts" },
  audit: { script: "verify:008:audit", path: "tools/verification/008-audit-coverage.mts" },
  scans: { script: "verify:008:scans", path: "tools/verification/008-security-scans.mts" },
  us3: { script: "verify:008:us3", path: "tools/verification/008-us3-checkpoint.mts" },
  us4: { script: "verify:008:us4", path: "tools/verification/008-us4-checkpoint.mts" },
  us5: { script: "verify:008:us5", path: "tools/verification/008-us5-checkpoint.mts" },
  compatibility: {
    script: "verify:008:compatibility",
    path: "tools/verification/008-compatibility.mts",
  },
  migrations: { script: "verify:008:migrations", path: "tools/ci/verify-008-migrations.mts" },
  quickstart: { script: "verify:008:quickstart", path: "tools/verification/008-quickstart.mts" },
  smoke: { script: "smoke:008", path: "tools/smoke/feature-008.mts" },
  inputs: { script: "verify:008:inputs", path: "tools/verification/feature-008-inputs.mts" },
  integration: {
    script: "verify:008:integration",
    path: "tools/verification/feature-008-integration.mts",
  },
  security: { script: "verify:008:security", path: "tools/verification/feature-008-security.mts" },
  recovery: { script: "verify:008:recovery", path: "tools/verification/feature-008-recovery.mts" },
  shadow: { script: "verify:008:shadow", path: "tools/verification/feature-008-shadow.mts" },
  review: { script: "verify:008:review", path: "tools/verification/feature-008-review.mts" },
  trace: { script: "trace:008", path: "tools/verification/feature-008-trace.mts" },
  local: { script: "ci:008", path: "tools/ci/feature-008.mts" },
});
export type Command008 = keyof typeof COMMANDS_008;
export function commandScript008(key: Command008): string {
  return `node tools/verification/feature-008-command-catalog.mts run ${key}`;
}
export function commandState008(
  key: string,
  root = ROOT_008,
): "READY" | "NOT_IMPLEMENTED" | "UNKNOWN" {
  if (!Object.hasOwn(COMMANDS_008, key)) return "UNKNOWN";
  return existsSync(resolve(root, COMMANDS_008[key as Command008].path))
    ? "READY"
    : "NOT_IMPLEMENTED";
}
export function validateCommandCatalog008(root = ROOT_008): string[] {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const errors = Object.entries(COMMANDS_008).flatMap(([key, { script }]) =>
    pkg.scripts[script] === commandScript008(key as Command008)
      ? []
      : [`SCRIPT_MISMATCH:${script}`],
  );
  const quickstart = readFileSync(
    resolve(root, "specs/008-pilot-hardening-and-conformance/quickstart.md"),
    "utf8",
  );
  const documented = [...quickstart.matchAll(/pnpm ((?:verify:008:[\w-]+)|ci:008)/gu)].map(
    (m) => m[1]!,
  );
  for (const name of documented)
    if (!Object.values(COMMANDS_008).some((x) => x.script === name))
      errors.push(`UNKNOWN_DOCUMENTED_COMMAND:${name}`);
  return errors;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [verb, key, ...args] = process.argv.slice(2).filter((x) => x !== "--");
  if (verb === "--check" && key === undefined) {
    const errors = validateCommandCatalog008();
    console.log(
      JSON.stringify({
        catalogStatus: errors.length ? "FAIL" : "PASS",
        errors,
        commands: Object.keys(COMMANDS_008).map((key) => ({ key, state: commandState008(key) })),
      }),
    );
    if (errors.length) process.exitCode = 1;
  } else if (verb === "run" && key && commandState008(key) === "READY") {
    const result = spawnSync(process.execPath, [COMMANDS_008[key as Command008].path, ...args], {
      cwd: ROOT_008,
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
      },
    });
    process.exitCode = result.error ? 1 : (result.status ?? 1);
  } else {
    console.error(
      `[008] ${key ? commandState008(key) : "INVALID_COMMAND"}:${key ?? "MISSING"}; checkpoint did not run`,
    );
    process.exitCode = 1;
  }
}
