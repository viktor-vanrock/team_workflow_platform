import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const onboardingDocumentedScenarioIds = Object.freeze([
  "manual-only-onboarding",
  "full-qa-promotion",
  "cross-project-deny",
  "evidence-revision-retention",
  "emergency-suspend-resume",
] as const);

export type OnboardingDocumentedScenarioId = (typeof onboardingDocumentedScenarioIds)[number];

const documented = new Set<string>(onboardingDocumentedScenarioIds);

export function validateOnboardingScenarioCatalog(
  ids: readonly string[] = onboardingDocumentedScenarioIds,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`ONBOARDING_SCENARIO_ID_DUPLICATE:${id}`);
    seen.add(id);
    if (!documented.has(id)) throw new Error(`ONBOARDING_SCENARIO_ID_UNKNOWN:${id}`);
  }
  if (ids === onboardingDocumentedScenarioIds && seen.size !== 5) {
    throw new Error(`ONBOARDING_SCENARIO_CATALOG_CARDINALITY_INVALID:${seen.size}:5`);
  }
}

export function requireOnboardingScenarioId(value: string): OnboardingDocumentedScenarioId {
  if (!documented.has(value)) throw new Error(`ONBOARDING_SCENARIO_ID_UNKNOWN:${value}`);
  return value as OnboardingDocumentedScenarioId;
}

function run(): void {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  validateOnboardingScenarioCatalog();
  if (args.length === 0 || args.includes("--check")) {
    console.log(
      `[onboarding-scenario-catalog] PASS ${onboardingDocumentedScenarioIds.length}/5 documented scenario IDs`,
    );
    return;
  }
  if (args.length === 1 && args[0] === "--list") {
    console.log(onboardingDocumentedScenarioIds.join("\n"));
    return;
  }
  if (args.length !== 1) throw new Error("ONBOARDING_SCENARIO_ARGUMENTS_INVALID");
  console.log(requireOnboardingScenarioId(args[0]!));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
