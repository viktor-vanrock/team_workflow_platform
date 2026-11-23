import { QaReadinessRepository } from "../persistence/qa-readiness.repository.ts";
import type { QaQueryExecutor } from "../persistence/repository-helpers.ts";
import type { QaRetestLineageResolver } from "./qa-retest-lineage-resolver.ts";
import { evaluateQaReadiness, type QaReadinessEvaluationInput } from "./readiness-evaluator.ts";

export async function assessQaReadiness(
  input: QaReadinessEvaluationInput,
  executor: QaQueryExecutor,
  lineage?: QaRetestLineageResolver,
) {
  const assessment = await evaluateQaReadiness(input, lineage);
  const repository = new QaReadinessRepository(executor);
  await repository.appendAndMoveLatest(executor, assessment, input.extensionResourceVersion);
  return assessment;
}
