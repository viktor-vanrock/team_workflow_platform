import { randomUUID } from "node:crypto";

import type { QaFindingAggregate } from "../domain/finding.ts";
import { qaAggregateSnapshotHash, type QaContentHash } from "../domain/primitives.ts";
import { evaluateQaWordingModelInput } from "./model-input-policy.ts";

export type QaDraftFallbackReason =
  | "MODEL_UNSET"
  | "MODEL_CONFIGURATION_INVALID"
  | "MODEL_INPUT_DENIED"
  | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "MODEL_OUTPUT_INVALID";
export interface QaDraftWording {
  readonly title: string;
  readonly description: string;
  readonly stepsToReproduce: readonly string[];
  readonly expectedOutcome: string;
  readonly actualOutcome: string;
}
export interface QaDraftAssistant {
  propose(
    input: Readonly<{
      summary: string;
      classification: "PRODUCT";
      severity: string;
      observationCount: number;
    }>,
  ): Promise<unknown>;
}
export interface QaDefectDraftProposal extends QaDraftWording {
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly findingId: string;
  readonly frozenFindingReviewRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly source: "MODEL_PROPOSAL" | "DETERMINISTIC_FALLBACK";
  readonly fallbackReasonCode?: QaDraftFallbackReason;
  readonly modelRef?: Readonly<{ kind: string; id: string; version: string; contentHash: string }>;
  readonly promptTemplateRef: Readonly<{ key: "qa.defect-wording"; version: "1.0.0" }>;
  readonly proposalHash: QaContentHash;
  readonly generatedAt: string;
  readonly expiresAt: string;
}

const validWording = (value: unknown): value is QaDraftWording => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    ["title", "description", "expectedOutcome", "actualOutcome"].every(
      (key) => typeof row[key] === "string" && (row[key] as string).trim().length > 0,
    ) &&
    Array.isArray(row.stepsToReproduce) &&
    row.stepsToReproduce.length > 0 &&
    row.stepsToReproduce.every((step) => typeof step === "string" && step.trim().length > 0)
  );
};

const deterministic = (finding: QaFindingAggregate): QaDraftWording => {
  const review = finding.currentReview!;
  return Object.freeze({
    title: `[QA] ${review.summary}`,
    description: `${review.classificationReason}\n\nDisposition: ${review.dispositionReason}`,
    stepsToReproduce: Object.freeze(
      review.observationMembershipIds.map(
        (id, index) => `${index + 1}. Reproduce observation membership ${id}`,
      ),
    ),
    expectedOutcome: "The validated acceptance outcome is satisfied.",
    actualOutcome: review.summary,
  });
};

export async function requestQaDefectDraftWordingProposal(
  input: Readonly<{
    finding: QaFindingAggregate;
    assistant?: QaDraftAssistant;
    modelRef?: Readonly<{ kind: string; id: string; version: string; contentHash: string }>;
    dataClassificationKey: string;
    now: () => string;
    timeoutMs?: number;
  }>,
): Promise<QaDefectDraftProposal> {
  const review = input.finding.currentReview;
  const generatedAt = input.now();
  const expiresAt = new Date(Date.parse(generatedAt) + 15 * 60_000).toISOString();
  let wording: QaDraftWording = deterministic(input.finding);
  let source: QaDefectDraftProposal["source"] = "DETERMINISTIC_FALLBACK";
  let fallbackReasonCode: QaDraftFallbackReason | undefined;
  if (
    !review ||
    review.stage !== "FROZEN" ||
    review.classification !== "PRODUCT" ||
    review.dispositionDecision !== "CREATE_DEFECT"
  ) {
    fallbackReasonCode = "MODEL_CONFIGURATION_INVALID";
  } else if (!evaluateQaWordingModelInput(input.dataClassificationKey).allowed) {
    fallbackReasonCode = "MODEL_INPUT_DENIED";
  } else if (!input.assistant || !input.modelRef) {
    fallbackReasonCode = "MODEL_UNSET";
  } else {
    try {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("MODEL_TIMEOUT")), input.timeoutMs ?? 2_000);
      });
      const proposed = await Promise.race([
        input.assistant.propose({
          summary: review.summary,
          classification: "PRODUCT",
          severity: review.severity,
          observationCount: review.observationMembershipIds.length,
        }),
        timeout,
      ]);
      if (!validWording(proposed)) fallbackReasonCode = "MODEL_OUTPUT_INVALID";
      else {
        wording = Object.freeze(structuredClone(proposed));
        source = "MODEL_PROPOSAL";
      }
    } catch (error) {
      fallbackReasonCode =
        error instanceof Error && error.message === "MODEL_TIMEOUT"
          ? "MODEL_TIMEOUT"
          : "MODEL_UNAVAILABLE";
    }
  }
  const body = {
    proposalId: randomUUID(),
    workspaceId: input.finding.workspaceId,
    projectId: input.finding.projectId,
    workItemId: input.finding.workItemId,
    findingId: input.finding.findingId,
    frozenFindingReviewRef: {
      id: review!.id,
      version: review!.version,
      contentHash: review!.contentHash,
    },
    source,
    ...wording,
    ...(source === "MODEL_PROPOSAL"
      ? { modelRef: structuredClone(input.modelRef!) }
      : { fallbackReasonCode: fallbackReasonCode! }),
    promptTemplateRef: { key: "qa.defect-wording" as const, version: "1.0.0" as const },
    generatedAt,
    expiresAt,
  };
  return Object.freeze({ ...body, proposalHash: qaAggregateSnapshotHash(body as never) });
}

export class FakeQaDraftAssistant implements QaDraftAssistant {
  readonly calls: unknown[] = [];
  constructor(private readonly behavior: "VALID" | "INVALID" | "TIMEOUT" | "ERROR" = "VALID") {}
  async propose(
    input: Readonly<{
      summary: string;
      classification: "PRODUCT";
      severity: string;
      observationCount: number;
    }>,
  ): Promise<unknown> {
    this.calls.push(structuredClone(input));
    if (this.behavior === "INVALID") return { title: "" };
    if (this.behavior === "ERROR") throw new Error("MODEL_UNAVAILABLE");
    if (this.behavior === "TIMEOUT")
      return await new Promise(() => {
        /* Promise intentionally remains pending. */
      });
    return Object.freeze({
      title: `[Suggested] ${input.summary}`,
      description: `Human-classified PRODUCT finding (${input.severity}).`,
      stepsToReproduce: Object.freeze(["Reproduce the frozen observation set"]),
      expectedOutcome: "Acceptance outcome succeeds",
      actualOutcome: input.summary,
    });
  }
}
