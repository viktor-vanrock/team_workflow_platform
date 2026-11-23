import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const commands = [
  ["pnpm", ["run", "contracts:build", "--", "--check"]],
  ["pnpm", ["run", "architecture"]],
  [
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "tests/contract/design-contract-fixtures.spec.ts",
      "tests/integration/migrations/order-and-safety.spec.ts",
      "tests/integration/foundation-model.spec.ts",
      "tests/integration/security/authorization-policy.spec.ts",
      "tests/integration/security/request-trust-boundary.spec.ts",
      "tests/architecture",
    ],
  ],
] as const;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("FOUNDATION GATE: PASS");
