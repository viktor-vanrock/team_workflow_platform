export type QaModelInputDecision = Readonly<
  | { allowed: true; ceiling: "INTERNAL" }
  | { allowed: false; reasonCode: "MODEL_INPUT_CLASSIFICATION_DENIED" }
>;

export function evaluateQaWordingModelInput(dataClassificationKey: string): QaModelInputDecision {
  return dataClassificationKey === "PUBLIC" || dataClassificationKey === "INTERNAL"
    ? Object.freeze({ allowed: true as const, ceiling: "INTERNAL" as const })
    : Object.freeze({
        allowed: false as const,
        reasonCode: "MODEL_INPUT_CLASSIFICATION_DENIED" as const,
      });
}
