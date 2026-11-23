import type { QaManualAttemptResult } from "../domain/manual-attempt.ts";
import type { QaPlanItemHumanResult } from "../domain/plan-item-result.ts";
import { QaDomainError } from "../domain/primitives.ts";

export const qaEvidencePolicyV1 = Object.freeze({
  ref: Object.freeze({ key: "qa.evidence", version: "1.0.0" }),
  allowedMediaTypes: Object.freeze(["image/png", "image/jpeg", "text/plain", "application/json"]),
  maximumSizeBytes: 10 * 1024 * 1024,
  negativeAttemptResults: Object.freeze([
    "ASSERTION_FAILED",
    "INFRA_FAILED",
    "TIMEOUT",
    "INCOMPLETE",
  ] as const),
  negativeHumanResults: Object.freeze(["FAIL", "BLOCKED", "INCONCLUSIVE"] as const),
});

export function attemptRequiresEvidence(result: QaManualAttemptResult): boolean {
  return (qaEvidencePolicyV1.negativeAttemptResults as readonly string[]).includes(result);
}

export function planItemResultRequiresEvidence(result: QaPlanItemHumanResult): boolean {
  return (qaEvidencePolicyV1.negativeHumanResults as readonly string[]).includes(result);
}

export function assertEvidenceUploadAllowed(mediaType: string, sizeBytes: number): void {
  if (!(qaEvidencePolicyV1.allowedMediaTypes as readonly string[]).includes(mediaType))
    throw new QaDomainError("QA_EVIDENCE_MEDIA_TYPE_DENIED");
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > qaEvidencePolicyV1.maximumSizeBytes
  )
    throw new QaDomainError("QA_EVIDENCE_SIZE_DENIED");
}
