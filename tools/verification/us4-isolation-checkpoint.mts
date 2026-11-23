import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "tests/integration/security/acceptance/at-010-scope-isolation.spec.ts",
  "tests/integration/composite-scope-constraints.spec.ts",
  "tests/integration/security/tampered-job-envelope.spec.ts",
  "tests/integration/security/audit-query-scope.spec.ts",
  "tests/integration/security/authorization-surface-catalog.spec.ts",
  "tests/integration/scope-isolation-surfaces.spec.ts",
  "tests/e2e/001-isolation.spec.ts",
] as const;
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "true" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "US4 ISOLATION CHECKPOINT: PASS (AT-010, composite scope FK, deny-before-adapter/stream, browser/API isolation)",
);
