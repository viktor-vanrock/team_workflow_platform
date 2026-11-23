import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { onboardingDocumentedScenarioIds } from "../local/onboarding-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";
import { quickstartCommands } from "./quickstart-commands.mts";

const workspace = resolve(import.meta.dirname, "../..");
const quickstartPath = resolve(
  workspace,
  "specs/007-project-onboarding-evidence-security/quickstart.md",
);
const reportDirectory = resolve(workspace, "reports/007-project-onboarding-evidence-security");
const reportPath = resolve(reportDirectory, "quickstart.json");
const planOnly = process.argv
  .slice(2)
  .filter((value) => value !== "--")
  .includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown verify:007:quickstart arguments: ${unknown.join(", ")}`);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const markdown = readFileSync(quickstartPath, "utf8");
const packageBytes = readFileSync(resolve(workspace, "package.json"));
const packageJson = JSON.parse(packageBytes.toString("utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const documentedCommands = quickstartCommands(markdown);
const documentedScripts = Object.freeze([
  ...new Set(
    documentedCommands.flatMap((command) =>
      command.startsWith("pnpm ") ? [command.split(/\s+/u)[1]!] : [],
    ),
  ),
]);
const builtins = new Set(["install"]);
const orphanedScripts = documentedScripts.filter(
  (script) => !builtins.has(script) && !(script in packageJson.scripts),
);
const documentedScenarios = Object.freeze([
  ...new Set(
    documentedCommands.flatMap((command) => {
      const match = /^pnpm onboarding:scenario -- run ([^\s]+)/u.exec(command);
      return match ? [match[1]!] : [];
    }),
  ),
]);
const orphanedScenarios = documentedScenarios.filter(
  (id) =>
    !onboardingDocumentedScenarioIds.includes(
      id as (typeof onboardingDocumentedScenarioIds)[number],
    ),
);
const undocumentedScenarios = onboardingDocumentedScenarioIds.filter(
  (id) => !documentedScenarios.includes(id),
);
const isolated = new Set([
  "local:onboarding:up",
  "local:onboarding:migrate",
  "local:onboarding:seed",
  "local:onboarding:status",
  "local:onboarding:down",
  "onboarding:scenario",
  "smoke:007",
]);
const dispositions = documentedCommands.map((command) => {
  if (command === "corepack enable")
    return Object.freeze({ command, script: "corepack", disposition: "PACKAGE_MANAGER_BUILTIN" });
  const script = command.split(/\s+/u)[1]!;
  const disposition =
    builtins.has(script) || script === "prerequisites"
      ? "PACKAGE_MANAGER_BUILTIN"
      : isolated.has(script)
        ? "ISOLATED_CONTOUR"
        : script === "onboarding:inputs"
          ? "SAFE_INPUT_VALIDATION"
          : script.startsWith("test:")
            ? "TEST_SUITE"
            : script.includes("007") || script === "trace:007"
              ? "FEATURE_007_GATE"
              : "UNCLASSIFIED";
  return Object.freeze({ command, script, disposition });
});
const unclassifiedCommands = dispositions
  .filter(({ disposition }) => disposition === "UNCLASSIFIED")
  .map(({ command }) => command);
const expectedReports = Object.freeze([
  "prerequisites.json",
  "governance.json",
  "setup-gate.json",
  "contracts.json",
  "architecture.json",
  "unit-matrices.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "us5.json",
  "migrations-postgres-17.json",
  "migrations-postgres-18.json",
  "concurrency.json",
  "integration.json",
  "security.json",
  "recovery.json",
  "observability.json",
  "browser.json",
  "smoke.json",
]);
const now = Date.now();
const reports = expectedReports.map((name) => {
  const file = resolve(reportDirectory, name);
  if (!existsSync(file))
    return Object.freeze({ name, status: "MISSING", fresh: false, accepted: false });
  try {
    const bytes = readFileSync(file);
    const report = JSON.parse(bytes.toString("utf8")) as Readonly<Record<string, unknown>>;
    const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
      (value) => typeof value === "string",
    ) as string | undefined;
    const fresh =
      (timestamp ? now - Date.parse(timestamp) : now - statSync(file).mtimeMs) <= 24 * 60 * 60_000;
    return Object.freeze({
      name,
      status: String(report.status ?? "INVALID"),
      fresh,
      accepted: report.status === "PASS" && fresh,
      sha256: digest(bytes),
    });
  } catch {
    return Object.freeze({ name, status: "INVALID", fresh: false, accepted: false });
  }
});
const invalid =
  orphanedScripts.length > 0 ||
  orphanedScenarios.length > 0 ||
  undocumentedScenarios.length > 0 ||
  unclassifiedCommands.length > 0 ||
  reports.some(({ accepted }) => !accepted);
if (planOnly) {
  console.log(
    `[verify:007:quickstart:plan] commands=${documentedCommands.length}; scripts=${documentedScripts.length}; scenarios=${documentedScenarios.length}/${onboardingDocumentedScenarioIds.length}; reports=${reports.filter(({ accepted }) => accepted).length}/${reports.length}`,
  );
  if (
    orphanedScripts.length ||
    orphanedScenarios.length ||
    undocumentedScenarios.length ||
    unclassifiedCommands.length
  )
    console.error(
      JSON.stringify({
        orphanedScripts,
        orphanedScenarios,
        undocumentedScenarios,
        unclassifiedCommands,
      }),
    );
  process.exitCode = invalid ? 1 : 0;
} else {
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "007-project-onboarding-evidence-security",
    checkpoint: "QUICKSTART",
    status: invalid ? "FAIL" : "PASS",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    documentedCommands: documentedCommands.length,
    documentedScripts: documentedScripts.length,
    documentedScenarios: documentedScenarios.length,
    orphanedScripts,
    orphanedScenarios,
    undocumentedScenarios,
    unclassifiedCommands,
    commandCoverage: dispositions,
    reports,
    sourceBinding: Object.freeze({
      quickstart: digest(markdown),
      packageJson: digest(packageBytes),
      scenarioCatalog: digest(
        readFileSync(resolve(workspace, "tools/local/onboarding-scenario-catalog.mts")),
      ),
    }),
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, reportPath);
  console.log(
    `[verify:007:quickstart] ${report.status}; commands=${documentedCommands.length}; scenarios=${documentedScenarios.length}/${onboardingDocumentedScenarioIds.length}; reports=${reports.filter(({ accepted }) => accepted).length}/${reports.length}; report: ${reportPath}`,
  );
  if (invalid) process.exitCode = 1;
}
