import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "tests/integration/acceptance/at-004-extension-registration.spec.ts",
  "tests/integration/extension-registration-rejection.spec.ts",
  "tests/integration/work-type-enablement.spec.ts",
  "tests/integration/migrations/us2-composition.spec.ts",
  "tests/architecture/acceptance/at-005-extension-boundaries.spec.ts",
  "tests/contract/acceptance/at-006-typed-capabilities.spec.ts",
];
const result = spawnSync("pnpm", ["exec", "vitest", "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "true" },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "US2 EXTENSION CHECKPOINT: PASS (AT-004, AT-005, AT-006, collision isolation, history-after-disable)",
);
