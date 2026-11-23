import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
if (args.some((v) => !["--plan", "--existing"].includes(v)))
  throw new Error("SMOKE_BROWSER_ARGUMENT_UNKNOWN");
if (args.includes("--plan")) {
  console.log(
    "Chromium: tests/e2e/007/compose-live.spec.ts against the existing isolated 007 Compose runtime, no route interception.",
  );
  process.exit(0);
}
if (!args.includes("--existing"))
  throw new Error("Run smoke:007 to create the isolated browser runtime");
const project = process.env.AWP_LOCAL_PROJECT_NAME ?? "",
  input = process.env.AWP_007_SMOKE_INPUT;
if (!/^awp-local-007-smoke-[a-z0-9]+-[0-9]+$/u.test(project) || !input)
  throw new Error("SMOKE_BROWSER_SCOPE_REQUIRED");
if ((JSON.parse(readFileSync(input, "utf8")) as { projectName: string }).projectName !== project)
  throw new Error("SMOKE_BROWSER_INPUT_SCOPE_MISMATCH");
for (const key of ["AWP_WEB_URL", "AWP_API_URL"]) {
  const url = new URL(process.env[key] ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("SMOKE_BROWSER_LOOPBACK_REQUIRED");
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/007/compose-live.spec.ts",
    "--project=chromium",
    "--workers=1",
  ],
  { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit", timeout: 180000 },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
