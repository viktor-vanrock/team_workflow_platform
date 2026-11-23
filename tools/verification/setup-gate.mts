import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  packageManager: string;
  devDependencies: Record<string, string>;
};
const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
const exact = {
  packageManager: "pnpm@11.21.0",
  nx: "23.1.2",
  typescript: "6.0.3",
  vitest: "4.1.11",
};
if (
  pkg.packageManager !== exact.packageManager ||
  pkg.devDependencies.nx !== exact.nx ||
  pkg.devDependencies.typescript !== exact.typescript ||
  pkg.devDependencies.vitest !== exact.vitest
) {
  throw new Error("Root tool versions drifted from the feature-001 exact toolchain");
}
for (const pin of [
  "@nestjs/common': 11.2.3",
  "typeorm: 1.1.0",
  "typebox: 1.3.19",
  "ajv: 8.20.0",
  "react: 19.2.8",
]) {
  if (!workspace.includes(pin)) throw new Error(`Workspace catalog is missing exact target ${pin}`);
}
const commands = [
  ["pnpm", ["install", "--frozen-lockfile"]],
  ["pnpm", ["exec", "nx", "show", "projects"]],
  ["pnpm", ["run", "architecture"]],
  ["pnpm", ["run", "typecheck"]],
  ["pnpm", ["run", "build"]],
] as const;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("SETUP GATE: PASS");
