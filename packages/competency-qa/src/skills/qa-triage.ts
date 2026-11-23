import { designContractRegistry, type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  type QaTriageLevel,
  validateQaTriageAssessmentContent,
} from "../domain/triage-assessment.ts";

export interface QaProposalSubject {
  readonly kind: "DRAFT" | "CANDIDATE" | "WORK_ITEM";
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}
export interface QaProposalFact {
  readonly sourceRef: string;
  readonly sourceVersion: string;
  readonly contentHash: string;
  readonly polarity?: "SUPPORTS" | "CONTRADICTS" | "UNKNOWN";
  readonly dimension?:
    | "businessImpact"
    | "urgencySla"
    | "risk"
    | "effortRange"
    | "scopeBreadth"
    | "environmentDataComplexity"
    | "automationAvailability";
}
const ref = (key: string) => Object.freeze({ key, version: "1.0.0", hash: sha256({ key }) });
export function deterministicQaTriage(
  input: Readonly<{
    assessmentId: string;
    workspaceId: string;
    projectId: string;
    subject: QaProposalSubject;
    revision: number;
    facts: readonly QaProposalFact[];
    agentRunId: string;
    now: Date;
    expiresAt: Date;
  }>,
) {
  if (!input.facts.length) throw new Error("TRIAGE_FACTS_REQUIRED");
  const facts = input.facts.map((fact) => ({ ...fact, polarity: fact.polarity ?? "UNKNOWN" }));
  const impact = facts.some(({ polarity }) => polarity === "SUPPORTS") ? "MEDIUM" : "UNKNOWN";
  return Object.freeze({
    schemaVersion: "triage-assessment@1.0.0",
    assessmentId: input.assessmentId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    subject: input.subject,
    revision: input.revision,
    dimensions: {
      businessImpact: impact,
      urgencySla: "UNKNOWN",
      risk: "UNKNOWN",
      effortRange: { kind: "UNKNOWN" },
      scopeBreadth: "UNKNOWN",
      environmentDataComplexity: "UNKNOWN",
      uncertainty: "HIGH",
      automationAvailability: "UNKNOWN",
    },
    recommendations: {
      complexity: {
        value: "UNKNOWN",
        rationale: "Недостаточно подтверждённых фактов",
        factRefs: [0],
      },
      priority: {
        value: "UNKNOWN",
        rationale: "Приоритет остаётся решением человека",
        factRefs: [0],
      },
      queueBand: {
        value: "UNKNOWN",
        rationale: "Очередь не изменяется предложением",
        factRefs: [0],
      },
    },
    facts,
    explanation: "Детерминированная безопасная оценка по доступным фактам.",
    confidence: 0,
    inputFingerprint: sha256({ subject: input.subject, facts } as unknown as JsonValue),
    rulesRef: ref("qa.triage"),
    skillRef: ref("qa-triage"),
    policyRef: ref("qa.agent-policy"),
    agentRunRef: input.agentRunId,
    actionProvenanceRef: `agent-run:${input.agentRunId}:triage`,
    state: "CURRENT",
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.now.toISOString(),
  });
}

export const QA_TRIAGE_V11_SCHEMA_ID = "urn:awp:schemas:004:triage-assessment:v1.1" as const;
export const QA_TRIAGE_V11_SKILL_VERSION = "1.1.0" as const;
export const QA_TRIAGE_V11_RULE_VERSION = "1.1.0" as const;
export const qaTriageV11InputProfile = Object.freeze({
  key: "qa-triage-input",
  version: "1.1.0",
  subjectKinds: Object.freeze(["DRAFT", "CANDIDATE", "WORK_ITEM"] as const),
  factFamilies: Object.freeze([
    "JIRA_OPERATIONAL_PROJECTION_REVISION",
    "QA_QUEUE_FACT_REVISION",
    "QA_AUTOMATED_ACTIVITY_FACT_SET",
  ] as const),
  maximumFacts: 100,
});
export const qaTriageV11OutputProfile = Object.freeze({
  key: "qa-triage-output",
  version: "1.1.0",
  schemaId: QA_TRIAGE_V11_SCHEMA_ID,
  requiredEvidence: Object.freeze([
    "dimensionDetails",
    "missingInformation",
    "inputFingerprintComponents",
    "ruleVersion",
    "skillVersion",
  ] as const),
  proposalOnly: true,
  totalScoreAllowed: false,
  fallback: "DETERMINISTIC" as const,
});

export interface QaTriageFingerprintRef {
  readonly sourceType:
    | "INTAKE_CANDIDATE_REVISION"
    | "INTAKE_DRAFT_REVISION"
    | "WORK_ITEM_REVISION"
    | "JIRA_OPERATIONAL_PROJECTION_REVISION"
    | "QA_QUEUE_FACT_REVISION"
    | "QA_AUTOMATED_ACTIVITY_FACT_SET";
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly semanticHash: string;
  readonly confirmedAt?: string;
}

export type QaTriageFingerprintComponent =
  | Readonly<{ state: "KNOWN"; sourceRef: QaTriageFingerprintRef }>
  | Readonly<{
      state: "UNKNOWN";
      reasonCode:
        "NOT_OBSERVED" | "NOT_AVAILABLE" | "NOT_AUTHORIZED" | "SOURCE_STALE" | "SOURCE_ERROR";
    }>
  | Readonly<{
      state: "NOT_APPLICABLE";
      reasonCode: "SUBJECT_NOT_WORK_ITEM" | "AUTOMATION_NOT_CONFIGURED";
    }>;

export interface QaTriageV11FingerprintComponents {
  readonly subject: QaTriageFingerprintRef;
  readonly jiraOperationalProjection: QaTriageFingerprintComponent;
  readonly qaPlanningFacts: QaTriageFingerprintComponent;
  readonly automationFacts: QaTriageFingerprintComponent;
}

const v11Ref = (key: string, version: string) =>
  Object.freeze({ key, version, hash: sha256({ key, version }) });
const dimensionKeys = [
  "businessImpact",
  "urgencySla",
  "risk",
  "effortRange",
  "scopeBreadth",
  "environmentDataComplexity",
  "uncertainty",
  "automationAvailability",
] as const;

function fallbackDimensionValue(
  key: (typeof dimensionKeys)[number],
  facts: readonly QaProposalFact[],
): QaTriageLevel | Readonly<{ kind: "UNKNOWN" }> {
  if (key === "effortRange") return Object.freeze({ kind: "UNKNOWN" });
  if (
    key === "businessImpact" &&
    facts.some((fact) => fact.dimension === key && fact.polarity === "SUPPORTS")
  )
    return "MEDIUM";
  return key === "uncertainty" ? "HIGH" : "UNKNOWN";
}

export function deterministicQaTriageV11(
  input: Readonly<{
    assessmentId: string;
    workspaceId: string;
    projectId: string;
    subject: QaProposalSubject;
    revision: number;
    previousAssessmentRef?: string;
    facts: readonly QaProposalFact[];
    inputFingerprintComponents: QaTriageV11FingerprintComponents;
    agentRunId: string;
    now: Date;
    expiresAt: Date;
  }>,
) {
  if (!input.facts.length) throw new Error("TRIAGE_FACTS_REQUIRED");
  const facts = input.facts.map((value) => {
    const { dimension, ...fact } = value;
    void dimension;
    return Object.freeze({ ...fact, polarity: fact.polarity ?? "UNKNOWN" });
  });
  const businessImpact = fallbackDimensionValue("businessImpact", input.facts);
  const dimensions = Object.freeze(
    Object.fromEntries(dimensionKeys.map((key) => [key, fallbackDimensionValue(key, input.facts)])),
  );
  const dimensionDetails = Object.freeze(
    Object.fromEntries(
      dimensionKeys.map((key) => [
        key,
        Object.freeze({
          confidence: key === "businessImpact" && businessImpact !== "UNKNOWN" ? 0.5 : 0,
          explanation:
            key === "businessImpact" && businessImpact !== "UNKNOWN"
              ? "Business impact is supported by an authorized input fact."
              : "No authoritative value was available; manual triage is required.",
          factRefs: Object.freeze([0]),
        }),
      ]),
    ),
  );
  const missingInformation =
    businessImpact === "UNKNOWN"
      ? Object.freeze([
          Object.freeze({
            key: "BUSINESS_IMPACT_MISSING" as const,
            dimension: "BUSINESS_IMPACT" as const,
            reasonCode: "NOT_PROVIDED" as const,
            explanation: "Business impact was not present in the authorized input facts.",
            factRefs: Object.freeze([0]),
          }),
        ])
      : Object.freeze([]);
  const inputFingerprint = sha256(input.inputFingerprintComponents as unknown as JsonValue);
  const output = {
    schemaVersion: "triage-assessment@1.1.0" as const,
    assessmentId: input.assessmentId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    subject: input.subject,
    revision: input.revision,
    ...(input.revision > 1
      ? {
          previousAssessmentRef:
            input.previousAssessmentRef ?? `${input.assessmentId}:r${input.revision - 1}`,
        }
      : {}),
    dimensions,
    dimensionDetails,
    recommendations: Object.freeze({
      complexity: Object.freeze({
        value: "UNKNOWN" as const,
        rationale: "Manual decision required; this output is proposal-only.",
        factRefs: Object.freeze([0]),
      }),
      priority: Object.freeze({
        value: "UNKNOWN" as const,
        rationale: "Jira priority remains an independently accepted operational value.",
        factRefs: Object.freeze([0]),
      }),
      queueBand: Object.freeze({
        value: "UNKNOWN" as const,
        rationale: "Queue order is changed only by an exact human action.",
        factRefs: Object.freeze([0]),
      }),
    }),
    facts,
    missingInformation,
    explanation: "Deterministic proposal-only fallback based solely on bounded authorized facts.",
    confidence: 0,
    inputFingerprintComponents: input.inputFingerprintComponents,
    inputFingerprint,
    ruleVersion: QA_TRIAGE_V11_RULE_VERSION,
    skillVersion: QA_TRIAGE_V11_SKILL_VERSION,
    rulesRef: v11Ref("qa-triage-rules", QA_TRIAGE_V11_RULE_VERSION),
    skillRef: v11Ref("qa-triage", QA_TRIAGE_V11_SKILL_VERSION),
    policyRef: v11Ref("qa.agent-policy", "1.0.0"),
    agentRunRef: input.agentRunId,
    actionProvenanceRef: `agent-run:${input.agentRunId}:triage`,
    state: "CURRENT" as const,
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.now.toISOString(),
  };
  designContractRegistry.validateById(QA_TRIAGE_V11_SCHEMA_ID, output);
  return Object.freeze(output);
}

export interface QaTriageModelPort {
  propose(
    input: Readonly<{
      outputSchemaId: typeof QA_TRIAGE_V11_SCHEMA_ID;
      facts: readonly QaProposalFact[];
      recommendationTemplate: ReturnType<typeof deterministicQaTriageV11>;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
}

export interface QaTriageModelPolicy {
  readonly version: string;
  readonly minimumConfidence: number;
  readonly deadlineMs: number;
}
export const qaTriageModelPolicy: QaTriageModelPolicy = Object.freeze({
  version: "1.0.0",
  minimumConfidence: 0.75,
  deadlineMs: 2_000,
});
type TriageFallbackReason =
  "MODEL_DISABLED" | "MODEL_UNAVAILABLE" | "MODEL_OUTPUT_INVALID" | "LOW_CONFIDENCE";
function freezeTriage<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeTriage);
    Object.freeze(value);
  }
  return value;
}

export async function runQaTriageV11(
  input: Parameters<typeof deterministicQaTriageV11>[0],
  model?: QaTriageModelPort,
  policy = qaTriageModelPolicy,
): Promise<
  Readonly<{
    executionMode: "MODEL" | "DETERMINISTIC_FALLBACK";
    assessment: ReturnType<typeof deterministicQaTriageV11>;
    fallbackReason?: TriageFallbackReason;
  }>
> {
  if (
    !Number.isFinite(policy.minimumConfidence) ||
    policy.minimumConfidence < 0 ||
    policy.minimumConfidence > 1 ||
    !Number.isSafeInteger(policy.deadlineMs) ||
    policy.deadlineMs < 1 ||
    policy.deadlineMs > 30_000
  )
    throw new Error("TRIAGE_MODEL_POLICY_INVALID");
  const baseline = freezeTriage(structuredClone(deterministicQaTriageV11(structuredClone(input))));
  let fallbackReason: TriageFallbackReason = model ? "MODEL_UNAVAILABLE" : "MODEL_DISABLED";
  if (model) {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const received = await Promise.race([
        model.propose({
          outputSchemaId: QA_TRIAGE_V11_SCHEMA_ID,
          facts: baseline.facts,
          recommendationTemplate: baseline,
          signal: abort.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error("TRIAGE_MODEL_TIMEOUT"));
          }, policy.deadlineMs);
        }),
      ]);
      fallbackReason = "MODEL_OUTPUT_INVALID";
      const proposed = designContractRegistry.validateById(
        QA_TRIAGE_V11_SCHEMA_ID,
        structuredClone(received),
      ) as typeof baseline;
      validateQaTriageAssessmentContent(proposed as Readonly<Record<string, unknown>>);
      // Model recommendations may vary; immutable identity, provenance and source facts may not.
      const fixed = [
        "schemaVersion",
        "assessmentId",
        "workspaceId",
        "projectId",
        "subject",
        "revision",
        "previousAssessmentRef",
        "facts",
        "inputFingerprintComponents",
        "inputFingerprint",
        "ruleVersion",
        "skillVersion",
        "rulesRef",
        "skillRef",
        "policyRef",
        "agentRunRef",
        "actionProvenanceRef",
        "state",
        "expiresAt",
        "createdAt",
      ] as const;
      for (const key of fixed)
        if (
          sha256((proposed[key] ?? null) as JsonValue) !==
          sha256((baseline[key] ?? null) as JsonValue)
        )
          throw new Error("TRIAGE_MODEL_INPUT_MISMATCH");
      if (proposed.confidence < policy.minimumConfidence) {
        fallbackReason = "LOW_CONFIDENCE";
        throw new Error("TRIAGE_MODEL_LOW_CONFIDENCE");
      }
      return Object.freeze({ executionMode: "MODEL", assessment: freezeTriage(proposed) });
    } catch {
      // A model failure or untrusted shape is deliberately collapsed to the same safe fallback.
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
  }
  return Object.freeze({
    executionMode: "DETERMINISTIC_FALLBACK",
    assessment: baseline,
    fallbackReason,
  });
}
