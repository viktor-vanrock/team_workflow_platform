import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "tests/integration/acceptance/at-007-capability-availability.spec.ts",
  "tests/integration/acceptance/at-008-command-recovery.spec.ts",
  "tests/integration/security/acceptance/at-009-webhook-security.spec.ts",
  "tests/integration/security/acceptance/at-011-audit-completeness.spec.ts",
  "tests/contract/acceptance/at-012-mock-hub.spec.ts",
  "tests/contract/acceptance/at-013-connector-substitution.spec.ts",
  "tests/integration/acceptance/at-014-configuration-versioning.spec.ts",
  "tests/integration/security/acceptance/at-015-approval-effect-gate.spec.ts",
  "tests/integration/acceptance/at-016-resilience.spec.ts",
  "tests/contract/acceptance/at-017-command-state-matrix.spec.ts",
  "tests/contract/acceptance/at-018-strategy-intersection.spec.ts",
  "tests/integration/security/acceptance/at-019-binding-publication.spec.ts",
  "tests/integration/command-gateway-transaction.spec.ts",
  "tests/integration/durable-effect-regression.spec.ts",
  "tests/integration/durable-persistence-postgres.spec.ts",
  "tests/integration/binding-publication-postgres.spec.ts",
  "tests/integration/integration-configuration-persistence.spec.ts",
  "tests/integration/mock-hub-persistence.spec.ts",
  "tests/e2e/001-durable-preview.spec.ts",
];
const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "true", npm_config_ignore_scripts: "true" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "US3 DURABLE CHECKPOINT: PASS (AT-007–AT-009, AT-011–AT-019, real PostgreSQL authority, effectCount=1)",
);
