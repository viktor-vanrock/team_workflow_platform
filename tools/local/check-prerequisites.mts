import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expected = Object.freeze({
  node: "24.20.0",
  pnpm: "11.21.0",
  dockerMajor: 24,
  compose: [2, 20] as const,
});
const workspace = resolve(import.meta.dirname, "../..");

function command(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "UNAVAILABLE";
  }
}
function versionTuple(value: string): number[] {
  return value
    .replace(/^v/u, "")
    .split(/[.-]/u)
    .map((part) => Number(part));
}
function atLeast(actual: number[], expectedMinimum: readonly number[]): boolean {
  for (let index = 0; index < expectedMinimum.length; index += 1) {
    const left = actual[index] ?? 0;
    const right = expectedMinimum[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

const node = process.versions.node;
const pnpm = command("pnpm", ["--version"]);
const docker = command("docker", ["--version"]);
const compose = command("docker", ["compose", "version", "--short"]);
const configuredNode = readFileSync(resolve(workspace, ".node-version"), "utf8").trim();
const failures: string[] = [];
if (configuredNode !== expected.node)
  failures.push(`.node-version=${configuredNode}; expected ${expected.node}`);
if (node !== expected.node) failures.push(`Node=${node}; expected ${expected.node}`);
if (pnpm !== expected.pnpm) failures.push(`pnpm=${pnpm}; expected ${expected.pnpm}`);
if (
  !docker.includes("version") ||
  (versionTuple(docker.match(/\d+(?:\.\d+)+/u)?.[0] ?? "0")[0] ?? 0) < expected.dockerMajor
)
  failures.push(`Docker=${docker}; expected >=24`);
if (!atLeast(versionTuple(compose), expected.compose))
  failures.push(`Compose=${compose}; expected >=2.20`);

if (failures.length > 0) {
  console.error(
    ["Toolchain prerequisite check failed:", ...failures.map((failure) => `- ${failure}`)].join(
      "\n",
    ),
  );
  process.exitCode = 1;
} else {
  console.log(`Toolchain OK: Node ${node}, pnpm ${pnpm}, Docker ${docker}, Compose ${compose}`);
}
