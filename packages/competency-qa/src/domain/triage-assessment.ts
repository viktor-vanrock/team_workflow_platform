import {
  designContractRegistry,
  type JsonValue,
  sha256,
  type Sha256Digest,
} from "@awp/platform-contracts";

export const TRIAGE_ASSESSMENT_V11_SCHEMA_ID =
  "urn:awp:schemas:004:triage-assessment:v1.1" as const;

export type QaProposalState = "CURRENT" | "STALE" | "SUPERSEDED";
export type QaTriageStaleReason =
  "SOURCE_CHANGED" | "SOURCE_REVOKED" | "PROFILE_CHANGED" | "BINDING_CHANGED" | "EXPIRED";
export type QaTriageLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
export type QaTriageEffortRange =
  | Readonly<{ kind: "UNKNOWN" }>
  | Readonly<{
      kind: "ESTIMATE";
      lower: number;
      upper: number;
      unit: "PERSON_HOURS" | "PERSON_DAYS" | "SESSION_COUNT";
    }>;

export interface QaTriageFact {
  readonly sourceRef: string;
  readonly sourceVersion: string;
  readonly contentHash: string;
  readonly polarity: "SUPPORTS" | "CONTRADICTS" | "UNKNOWN";
}

export interface QaTriageAssessmentSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subject: Readonly<{
    kind: "DRAFT" | "CANDIDATE" | "WORK_ITEM";
    id: string;
    version: number;
    contentHash: string;
  }>;
  readonly revision: number;
  readonly content: Readonly<Record<string, unknown>>;
  readonly contentHash: Sha256Digest;
  readonly sourceFactSetHash: Sha256Digest;
  readonly state: QaProposalState;
  readonly expiresAt: Date;
  readonly staleAt?: Date;
  readonly staleReasonCode?: QaTriageStaleReason;
}

type FactIndexed = Readonly<{ factRefs?: readonly number[] }>;
type FingerprintRef = Readonly<{
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  semanticHash: string;
}>;

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
}

function validateFactRefs(value: unknown, factsLength: number): void {
  const indexed = record(value, "TRIAGE_FACT_EVIDENCE_INVALID") as FactIndexed;
  for (const index of indexed.factRefs ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= factsLength) {
      throw new Error("TRIAGE_FACT_INDEX_INVALID");
    }
  }
}

function validateEffortRange(value: unknown): void {
  if (value === undefined) return;
  const effort = record(value, "TRIAGE_EFFORT_RANGE_INVALID");
  if (
    effort.kind === "ESTIMATE" &&
    (typeof effort.lower !== "number" ||
      typeof effort.upper !== "number" ||
      effort.lower > effort.upper)
  ) {
    throw new Error("TRIAGE_EFFORT_RANGE_INVALID");
  }
}

function validateV11(
  content: Readonly<Record<string, unknown>>,
  facts: readonly QaTriageFact[],
): void {
  if ("totalScore" in content || "score" in content)
    throw new Error("TRIAGE_TOTAL_SCORE_FORBIDDEN");
  designContractRegistry.validateById(TRIAGE_ASSESSMENT_V11_SCHEMA_ID, content);

  const dimensions = record(content.dimensions, "TRIAGE_DIMENSIONS_REQUIRED");
  validateEffortRange(dimensions.effortRange);
  const details = record(content.dimensionDetails, "TRIAGE_DIMENSION_DETAILS_REQUIRED");
  for (const detail of Object.values(details)) validateFactRefs(detail, facts.length);

  const missing = (content.missingInformation ?? []) as readonly Readonly<
    Record<string, unknown>
  >[];
  const missingKeys = missing.map(({ key }) => key);
  if (new Set(missingKeys).size !== missingKeys.length)
    throw new Error("TRIAGE_MISSING_INFORMATION_DUPLICATE");
  for (const item of missing) validateFactRefs(item, facts.length);
  const businessMissing = missingKeys.includes("BUSINESS_IMPACT_MISSING");
  if ((dimensions.businessImpact === "UNKNOWN") !== businessMissing) {
    throw new Error("TRIAGE_BUSINESS_IMPACT_MISSING_INCONSISTENT");
  }
  if (businessMissing && !("businessImpact" in details)) {
    throw new Error("TRIAGE_BUSINESS_IMPACT_EVIDENCE_REQUIRED");
  }

  const components = record(
    content.inputFingerprintComponents,
    "TRIAGE_FINGERPRINT_COMPONENTS_REQUIRED",
  );
  // The immutable v1.1 schema above validates each property-specific source family.
  const subjectComponent = record(
    components.subject,
    "TRIAGE_SUBJECT_FINGERPRINT_REQUIRED",
  ) as FingerprintRef;
  const subject = record(content.subject, "TRIAGE_SUBJECT_REQUIRED");
  if (
    subjectComponent.sourceId !== subject.id ||
    subjectComponent.sourceVersion !== subject.version ||
    subjectComponent.semanticHash !== subject.contentHash
  ) {
    throw new Error("TRIAGE_SUBJECT_FINGERPRINT_MISMATCH");
  }
  if (content.inputFingerprint !== sha256(components as JsonValue))
    throw new Error("TRIAGE_INPUT_FINGERPRINT_INVALID");

  const rulesRef = record(content.rulesRef, "TRIAGE_RULES_REF_REQUIRED");
  const skillRef = record(content.skillRef, "TRIAGE_SKILL_REF_REQUIRED");
  if (rulesRef.version !== content.ruleVersion) throw new Error("TRIAGE_RULE_VERSION_MISMATCH");
  if (skillRef.version !== content.skillVersion) throw new Error("TRIAGE_SKILL_VERSION_MISMATCH");
}

export function validateQaTriageAssessmentContent(
  content: Readonly<Record<string, unknown>>,
): void {
  const facts = content.facts as readonly QaTriageFact[] | undefined;
  if (!facts?.length) throw new Error("TRIAGE_FACTS_REQUIRED");
  const recommendations = content.recommendations as
    Readonly<Record<string, FactIndexed>> | undefined;
  for (const recommendation of Object.values(recommendations ?? {}))
    validateFactRefs(recommendation, facts.length);
  const dimensions = content.dimensions as Readonly<Record<string, unknown>> | undefined;
  validateEffortRange(dimensions?.effortRange);
  if (content.schemaVersion === "triage-assessment@1.1.0") validateV11(content, facts);
}

export function triageAssessmentFingerprint(
  content: Readonly<Record<string, unknown>>,
): Sha256Digest {
  const components = content.inputFingerprintComponents;
  return components === undefined
    ? sha256((content.facts ?? []) as JsonValue)
    : sha256(components as JsonValue);
}

export class QaTriageAssessmentAggregate {
  #value: QaTriageAssessmentSnapshot;

  private constructor(value: QaTriageAssessmentSnapshot) {
    this.#value = structuredClone(value);
  }

  static create(
    input: Omit<QaTriageAssessmentSnapshot, "contentHash" | "sourceFactSetHash" | "state">,
  ) {
    validateQaTriageAssessmentContent(input.content);
    const facts = input.content.facts as JsonValue;
    return new QaTriageAssessmentAggregate({
      ...input,
      contentHash: sha256(input.content as JsonValue),
      sourceFactSetHash: sha256(facts),
      state: "CURRENT",
    });
  }

  static restore(value: QaTriageAssessmentSnapshot) {
    validateQaTriageAssessmentContent(value.content);
    if (!new Set(["CURRENT", "STALE", "SUPERSEDED"]).has(value.state))
      throw new Error("TRIAGE_STATE_INVALID");
    if (sha256(value.content as JsonValue) !== value.contentHash)
      throw new Error("TRIAGE_CONTENT_HASH_INVALID");
    if (sha256(value.content.facts as JsonValue) !== value.sourceFactSetHash)
      throw new Error("TRIAGE_FACT_SET_HASH_INVALID");
    return new QaTriageAssessmentAggregate(value);
  }

  snapshot(): QaTriageAssessmentSnapshot {
    return structuredClone(this.#value);
  }

  stale(now: Date, reason: QaTriageStaleReason): QaTriageAssessmentSnapshot {
    if (this.#value.state !== "CURRENT") return this.snapshot();
    this.#value = { ...this.#value, state: "STALE", staleAt: now, staleReasonCode: reason };
    return this.snapshot();
  }

  supersede(): QaTriageAssessmentSnapshot {
    if (this.#value.state === "CURRENT") this.#value = { ...this.#value, state: "SUPERSEDED" };
    return this.snapshot();
  }

  assertUsable(currentFingerprint: string, now: Date): QaTriageAssessmentSnapshot {
    const expected =
      this.#value.content.schemaVersion === "triage-assessment@1.1.0"
        ? triageAssessmentFingerprint(this.#value.content)
        : this.#value.sourceFactSetHash;
    if (
      this.#value.state !== "CURRENT" ||
      expected !== currentFingerprint ||
      now >= this.#value.expiresAt
    ) {
      throw new Error("TRIAGE_ASSESSMENT_STALE");
    }
    return this.snapshot();
  }
}
