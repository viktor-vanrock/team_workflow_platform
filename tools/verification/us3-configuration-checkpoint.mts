import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "tests/integration/integration-configuration-lifecycle.spec.ts",
  "tests/integration/integration-configuration-persistence.spec.ts",
  "tests/integration/acceptance/at-007-capability-availability.spec.ts",
  "tests/contract/acceptance/at-012-mock-hub.spec.ts",
  "tests/contract/acceptance/at-013-connector-substitution.spec.ts",
  "tests/integration/acceptance/at-014-configuration-versioning.spec.ts",
  "tests/contract/acceptance/at-018-strategy-intersection.spec.ts",
  "tests/contract/connector-conformance.spec.ts",
  "tests/integration/mock-hub-persistence.spec.ts",
  "tests/integration/migrations/0060-entity-parity.spec.ts",
  "tests/integration/migrations/0070-entity-parity.spec.ts",
  "tests/integration/migrations/0080-audit-parity.spec.ts",
];
const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "true", npm_config_ignore_scripts: "true" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "US3 CONFIGURATION CHECKPOINT: PASS (AT-007, AT-012, AT-013, AT-014 preflight, AT-018, PostgreSQL configuration and Mock Hub)",
);
