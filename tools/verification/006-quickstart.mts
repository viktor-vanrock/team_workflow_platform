import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { queueDocumentedScenarioIds } from "../local/queue-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const quickstartPath = resolve(workspace, "specs/006-queue-triage-capacity-sla/quickstart.md");
const reportDirectory = resolve(workspace, "reports/006-queue-triage-capacity-sla");
const reportPath = resolve(reportDirectory, "quickstart.json");
const planOnly = process.argv
  .slice(2)
  .filter((value) => value !== "--")
  .includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown verify:006:quickstart arguments: ${unknown.join(", ")}`);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const markdown = readFileSync(quickstartPath, "utf8");
const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const documentedCommands = Object.freeze([
  ...new Set(
    markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("corepack pnpm "))
      .map((line) => line.replace(/\s*\\$/u, "")),
  ),
]);
const documentedScripts = Object.freeze([
  ...new Set(documentedCommands.map((command) => command.split(/\s+/u)[2]!)),
]);
const builtins = new Set(["install"]);
const orphanedScripts = documentedScripts.filter(
  (script) => !builtins.has(script) && !(script in packageJson.scripts),
);
const documentedScenarios = Object.freeze([
  ...new Set(
    documentedCommands.flatMap((command) => {
      const match = /^corepack pnpm queue:scenario -- ([^\s\\]+)/u.exec(command);
      return !match || match[1] === "--list" || match[1] === "reset" ? [] : [match[1]];
    }),
  ),
]);
const orphanedScenarios = documentedScenarios.filter(
  (id) => !queueDocumentedScenarioIds.includes(id as (typeof queueDocumentedScenarioIds)[number]),
);
const undocumentedScenarios = queueDocumentedScenarioIds.filter(
  (id) => !documentedScenarios.includes(id),
);
const destructive = new Set(["local:queue:reset"]);
const compatibility = new Set([
  "verify:002",
  "verify:003:evidence",
  "verify:004:evidence",
  "verify:005:evidence",
]);
const dispositions = documentedCommands.map((command) => {
  const script = command.split(/\s+/u)[2]!;
  const disposition = builtins.has(script)
    ? "PACKAGE_MANAGER_BUILTIN"
    : destructive.has(script)
      ? "OPERATOR_DESTRUCTIVE"
      : compatibility.has(script)
        ? "COMPATIBILITY_GATE"
        : script.startsWith("local:queue:") || script === "queue:scenario" || script === "smoke:006"
          ? "ISOLATED_CONTOUR"
          : script.startsWith("test:")
            ? "TEST_SUITE"
            : script.includes("006") || script === "trace:006"
              ? "FEATURE_006_GATE"
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
  "setup-contour.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "us5.json",
  "concurrency.json",
  "security.json",
  "rebuild.json",
  "observability.json",
  "migrations-postgres-17.json",
  "migrations-postgres-18.json",
  "browser.json",
  "smoke.json",
]);
const now = Date.now();
const reports = expectedReports.map((name) => {
  const path = resolve(reportDirectory, name);
  if (!existsSync(path))
    return Object.freeze({ name, status: "MISSING", fresh: false, accepted: false });
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
    const timestamp = [report.finishedAt, report.generatedAt, report.startedAt].find(
      (value) => typeof value === "string",
    ) as string | undefined;
    const fresh =
      (timestamp ? now - Date.parse(timestamp) : now - statSync(path).mtimeMs) <= 24 * 60 * 60_000;
    return Object.freeze({
      name,
      status: String(report.status ?? "INVALID"),
      fresh,
      accepted: report.status === "PASS" && fresh,
      sha256: digest(readFileSync(path)),
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
    `[verify:006:quickstart:plan] commands=${documentedCommands.length}; scripts=${documentedScripts.length}; scenarios=${documentedScenarios.length}/${queueDocumentedScenarioIds.length}; reports=${reports.filter(({ accepted }) => accepted).length}/${reports.length}`,
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
    feature: "006-queue-triage-capacity-sla",
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
      packageJson: digest(readFileSync(resolve(workspace, "package.json"))),
      scenarioCatalog: digest(
        readFileSync(resolve(workspace, "tools/local/queue-scenario-catalog.mts")),
      ),
    }),
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, reportPath);
  console.log(
    `[verify:006:quickstart] ${report.status}; commands=${documentedCommands.length}; scenarios=${documentedScenarios.length}/${queueDocumentedScenarioIds.length}; reports=${reports.filter(({ accepted }) => accepted).length}/${reports.length}; report: ${reportPath}`,
  );
  if (invalid) process.exitCode = 1;
}
