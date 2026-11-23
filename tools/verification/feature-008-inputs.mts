import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type InputStage008,
  validateInputPackage008,
} from "../../packages/platform-core/src/pilot/input-package.ts";
import {
  FEATURE_008,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "./feature-008-prerequisites.mts";

export type {
  InputId008,
  InputStage008,
} from "../../packages/platform-core/src/pilot/input-package.ts";
export {
  canonicalInputHash008,
  containsSensitiveValue008,
  INPUT_REQUIREMENTS_008,
  validateInputPackage008,
} from "../../packages/platform-core/src/pilot/input-package.ts";
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let input: string | undefined;
  let stage: InputStage008 = "C1";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") input = args[++i];
    else if (args[i] === "--stage" && ["C1", "N2", "P3"].includes(args[i + 1] ?? ""))
      stage = args[++i] as InputStage008;
    else throw new Error("UNKNOWN_INPUT_ARGUMENT");
  }
  let result: unknown;
  try {
    if (!input) throw new Error("INPUT_REQUIRED");
    const path = safeFile(ROOT_008, input);
    if (statSync(path).size > 1_048_576) throw new Error("INPUT_TOO_LARGE");
    result = validateInputPackage008(JSON.parse(readFileSync(path, "utf8")) as unknown, stage);
  } catch {
    result = {
      status: "BLOCKED_INPUT",
      corporateReady: false,
      reasonCodes: ["INPUT_FILE_UNAVAILABLE_OR_INVALID"],
    };
  }
  write008Json(`reports/${FEATURE_008}/input-validation.json`, result);
  console.log(JSON.stringify(result));
  if (!record(result) || result.status !== "PASS") process.exitCode = 1;
}
