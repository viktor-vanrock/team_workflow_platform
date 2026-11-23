import { type JsonValue, sha256 } from "@awp/platform-contracts";

export const qaIntakeFieldOrder = Object.freeze([
  "title",
  "requestKind",
  "goal",
  "scope",
  "acceptanceOutcome",
  "sourceRefs",
  "blockers",
  "dependencies",
  "requestedTarget",
  "requestRisk",
  "businessImpact",
  "desiredDate",
  "checklistRefs",
  "roleMetadataRefs",
  "requestedClassificationKey",
  "defectRef",
  "previousSessionRef",
  "sourceBuildRef",
] as const);
export type QaIntakeFieldKey = (typeof qaIntakeFieldOrder)[number];

export interface QaIntakeRevisionSubject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly draftId: string;
  readonly revision: number;
  readonly contentHash: `sha256:${string}`;
  readonly content: Readonly<Record<string, JsonValue>>;
}

const requestKinds = new Set([
  "feature-validation",
  "smoke",
  "regression",
  "retest",
  "investigation",
]);
const classifications = /^[A-Z][A-Z0-9_]{1,63}$/u;
const required = Object.freeze(["title", "requestKind", "requestedClassificationKey"] as const);

export function assessQaIntakeCompleteness(
  subject: QaIntakeRevisionSubject,
  createdAt = new Date(),
): Readonly<Record<string, unknown>> {
  const missingFields = required.filter((key) => !Object.hasOwn(subject.content, key));
  const invalid = new Set<QaIntakeFieldKey>();
  const title = subject.content.title;
  if (
    title !== undefined &&
    (typeof title !== "string" || title.trim().length === 0 || title.length > 500)
  )
    invalid.add("title");
  const requestKind = subject.content.requestKind;
  if (
    requestKind !== undefined &&
    (typeof requestKind !== "string" || !requestKinds.has(requestKind))
  )
    invalid.add("requestKind");
  const classification = subject.content.requestedClassificationKey;
  if (
    classification !== undefined &&
    (typeof classification !== "string" || !classifications.test(classification))
  )
    invalid.add("requestedClassificationKey");
  if (requestKind !== "retest")
    for (const key of ["defectRef", "previousSessionRef", "sourceBuildRef"] as const)
      if (subject.content[key] !== undefined) invalid.add(key);
  const invalidFields = qaIntakeFieldOrder.filter((key) => invalid.has(key));
  const state =
    invalidFields.length > 0 ? "INVALID" : missingFields.length > 0 ? "INCOMPLETE" : "VALID";
  const rulesRef = Object.freeze({
    key: "qa.intake-completeness",
    version: "1.0.0",
    hash: sha256({ required: [...required], order: [...qaIntakeFieldOrder] }),
  });
  const skillRef = Object.freeze({
    key: "qa-intake-readiness",
    version: "1.0.0",
    hash: sha256({ key: "qa-intake-readiness", version: "1.0.0" }),
  });
  return Object.freeze({
    schemaVersion: "intake-completeness@1.0.0",
    workspaceId: subject.workspaceId,
    projectId: subject.projectId,
    draftId: subject.draftId,
    revision: subject.revision,
    contentHash: subject.contentHash,
    state,
    missingFields: Object.freeze([...missingFields]),
    invalidFields: Object.freeze(invalidFields),
    blockers: Object.freeze(
      invalidFields.map((fieldKey) => Object.freeze({ code: "FIELD_INVALID", fieldKey })),
    ),
    inputFingerprint: sha256({
      revision: subject.revision,
      contentHash: subject.contentHash,
      content: subject.content,
    }),
    rulesRef,
    skillRef,
    actionProvenanceRef: `draft:${subject.draftId}:revision:${subject.revision}:completeness`,
    createdAt: createdAt.toISOString(),
  });
}
