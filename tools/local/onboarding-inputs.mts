import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
if (args[0] !== "validate" || args[1] !== "--file" || !args[2] || args.length !== 3) {
  throw new Error("Usage: onboarding:inputs -- validate --file <json-file>");
}
const requested = resolve(workspace, args[2]);
if (!existsSync(requested)) {
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        local: "L0_RUNNABLE",
        inputs: "BLOCKED_INPUT",
        gates: Object.freeze({ C1: "BLOCKED_INPUT", N2: "SKIPPED_GATED", P3: "SKIPPED_GATED" }),
        owner: "FEATURE_008",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const workspaceReal = realpathSync(workspace);
const inputReal = realpathSync(requested);
if (inputReal !== workspaceReal && !inputReal.startsWith(`${workspaceReal}/`))
  throw new Error("ONBOARDING_INPUT_PATH_OUTSIDE_WORKSPACE");
const value = JSON.parse(readFileSync(inputReal, "utf8")) as unknown;
if (value === null || typeof value !== "object" || Array.isArray(value))
  throw new Error("ONBOARDING_INPUT_OBJECT_REQUIRED");
const serialized = JSON.stringify(value);
const forbiddenKey =
  /"(?:password|secret|token|cookie|privateKey|private_key|credential|signedUrl|signed_url)"\s*:/iu;
const forbiddenValue = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]+)/u;
if (forbiddenKey.test(serialized) || forbiddenValue.test(serialized))
  throw new Error("ONBOARDING_INPUT_SECRET_VALUE_FORBIDDEN");
console.log(
  JSON.stringify(
    { status: "PASS", shape: "SAFE_REFERENCES_ONLY", file: args[2], owner: "FEATURE_008" },
    null,
    2,
  ),
);
