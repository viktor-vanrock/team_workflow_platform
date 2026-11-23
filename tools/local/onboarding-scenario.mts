import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runCrossProjectDenyScenario } from "../../packages/runtime-composition/src/onboarding/cross-project-deny-scenario.ts";
import { runEmergencySuspendResumeScenario } from "../../packages/runtime-composition/src/onboarding/emergency-suspend-resume-scenario.ts";
import { runEvidenceRevisionRetentionScenario } from "../../packages/runtime-composition/src/onboarding/evidence-revision-retention-scenario.ts";
import { runFullQaPromotionScenario } from "../../packages/runtime-composition/src/onboarding/full-qa-promotion-scenario.ts";
import { runManualOnlyOnboardingScenario } from "../../packages/runtime-composition/src/onboarding/manual-onboarding-scenario.ts";
import {
  onboardingDocumentedScenarioIds,
  requireOnboardingScenarioId,
} from "./onboarding-scenario-catalog.mts";

export async function runOnboardingScenario(id: string) {
  const scenarioId = requireOnboardingScenarioId(id);
  if (scenarioId === "manual-only-onboarding") return await runManualOnlyOnboardingScenario();
  if (scenarioId === "full-qa-promotion") return await runFullQaPromotionScenario();
  if (scenarioId === "cross-project-deny") return await runCrossProjectDenyScenario();
  if (scenarioId === "evidence-revision-retention")
    return await runEvidenceRevisionRetentionScenario();
  if (scenarioId === "emergency-suspend-resume") return await runEmergencySuspendResumeScenario();
  throw new Error(`ONBOARDING_SCENARIO_NOT_IMPLEMENTED:${scenarioId}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.length === 1 && args[0] === "list") {
    console.log(onboardingDocumentedScenarioIds.join("\n"));
    return;
  }
  if (args.length === 1 && args[0] === "run-all") {
    const results = [];
    for (const id of onboardingDocumentedScenarioIds)
      results.push(Object.freeze({ id, result: await runOnboardingScenario(id) }));
    console.log(
      JSON.stringify(
        {
          status: results.every(({ result }) => (result as { status?: string }).status === "PASS")
            ? "PASS"
            : "FAIL",
          scenarioCount: results.length,
          results,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (args.length !== 2 || args[0] !== "run")
    throw new Error("Usage: pnpm onboarding:scenario -- run <scenario-id>");
  const result = await runOnboardingScenario(args[1]!);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
