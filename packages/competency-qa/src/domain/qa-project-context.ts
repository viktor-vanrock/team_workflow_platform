import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";
import type { QaProjectExactRef, QaPublishedHumanActor } from "./project-resources.ts";

export interface QaExternalImmutableRef {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly contentHash: QaContentHash;
}

export interface QaSemanticRef {
  readonly key: string;
  readonly version: string;
  readonly contentHash: QaContentHash;
}

export interface QaRiskReviewPolicyRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: QaContentHash;
}

export interface QaProjectContext {
  readonly schemaVersion: 1;
  readonly contextId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly state: "PUBLISHED";
  readonly allowedEnvironments: readonly Readonly<{
    environmentId: string;
    revision: number;
    scope: "LOCAL" | "NON_PROD" | "PREPROD";
  }>[];
  readonly allowedResponseChannelKinds: readonly ["PLATFORM_WEB"];
  readonly requestAuthorityRequirementKey: "qa-request-authority";
  readonly defectDestinationRequirementKey: "defect-destination";
  readonly allowedTargetPolicyRefs: readonly QaExternalImmutableRef[];
  readonly allowedScopePolicyRefs: readonly QaExternalImmutableRef[];
  readonly allowedChecklistPolicyRefs: readonly QaExternalImmutableRef[];
  readonly defaultTargetPolicyRef: QaExternalImmutableRef;
  readonly defaultScopePolicyRef: QaExternalImmutableRef;
  readonly defaultChecklistRefs: readonly QaExternalImmutableRef[];
  readonly projectRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly maximumClassificationKey: string;
  readonly dorRuleSetRef: QaSemanticRef;
  readonly dodRuleSetRef: QaSemanticRef;
  readonly evidencePolicyRef: QaSemanticRef;
  readonly riskReviewPolicyRef: QaRiskReviewPolicyRef;
  readonly contentHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly publishedBy: QaHumanActor;
  readonly publishedAt: string;
}

export type QaContextV2Ref = QaExternalImmutableRef | QaProjectExactRef;

export interface QaProjectContextV2 {
  readonly schemaVersion: 2;
  readonly contextId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly state: "PUBLISHED" | "RETIRED";
  readonly environmentRefs: readonly QaContextV2Ref[];
  readonly testDataCatalogRefs: readonly QaContextV2Ref[];
  readonly accountPoolRefs: readonly QaContextV2Ref[];
  readonly targetPolicyRefs: readonly QaContextV2Ref[];
  readonly scopePolicyRefs: readonly QaContextV2Ref[];
  readonly checklistPolicyRefs: readonly QaContextV2Ref[];
  readonly defaultTargetPolicyRef: QaContextV2Ref;
  readonly defaultScopePolicyRef: QaContextV2Ref;
  readonly defaultChecklistRefs: readonly QaContextV2Ref[];
  readonly evidencePolicyRef: QaContextV2Ref;
  readonly retentionPolicyRef: QaContextV2Ref;
  readonly redactionPolicyRef: QaContextV2Ref;
  readonly exportPolicyRef: QaContextV2Ref;
  readonly riskReviewPolicyRef: QaContextV2Ref;
  readonly dorRuleSetRef: QaContextV2Ref;
  readonly dodRuleSetRef: QaContextV2Ref;
  readonly capabilityRequirementSetRef: QaContextV2Ref;
  readonly maximumClassificationKey: string;
  readonly resourceVersion: number;
  readonly contentHash: QaContentHash;
  readonly createdBy: QaHumanActor | QaPublishedHumanActor;
  readonly publishedBy: QaHumanActor | QaPublishedHumanActor;
  readonly publishedAt: string;
  readonly retiredAt?: string;
}

export type QaProjectContextV2Content = Omit<QaProjectContextV2, "schemaVersion" | "contentHash">;

export type QaProjectContextContent = Omit<
  QaProjectContext,
  "schemaVersion" | "state" | "contentHash"
>;

function refKey(ref: QaExternalImmutableRef): string {
  return `${ref.kind}\0${ref.id}\0${ref.version}\0${ref.contentHash}`;
}

function assertCatalog(catalog: readonly QaExternalImmutableRef[], code: string): Set<string> {
  if (catalog.length === 0) throw new QaDomainError(code);
  const keys = new Set(catalog.map(refKey));
  if (
    keys.size !== catalog.length ||
    catalog.some(
      (ref) =>
        !ref.contentHash.startsWith("sha256:") || ref.id.length === 0 || ref.version.length === 0,
    )
  ) {
    throw new QaDomainError(code);
  }
  return keys;
}

export function publishQaProjectContext(content: QaProjectContextContent): QaProjectContext {
  if (
    content.contextId.length === 0 ||
    content.version < 1 ||
    content.workspaceId.length === 0 ||
    content.projectId.length === 0 ||
    content.allowedEnvironments.length === 0 ||
    content.allowedResponseChannelKinds.length !== 1 ||
    content.allowedResponseChannelKinds[0] !== "PLATFORM_WEB" ||
    content.maximumClassificationKey.length === 0 ||
    Number.isNaN(Date.parse(content.publishedAt))
  )
    throw new QaDomainError("QA_PROJECT_CONTEXT_INVALID");
  const targets = assertCatalog(
    content.allowedTargetPolicyRefs,
    "QA_TARGET_POLICY_CATALOG_INVALID",
  );
  const scopes = assertCatalog(content.allowedScopePolicyRefs, "QA_SCOPE_POLICY_CATALOG_INVALID");
  const checklists = assertCatalog(
    content.allowedChecklistPolicyRefs,
    "QA_CHECKLIST_POLICY_CATALOG_INVALID",
  );
  if (!targets.has(refKey(content.defaultTargetPolicyRef)))
    throw new QaDomainError("QA_DEFAULT_TARGET_NOT_ALLOWED");
  if (!scopes.has(refKey(content.defaultScopePolicyRef)))
    throw new QaDomainError("QA_DEFAULT_SCOPE_NOT_ALLOWED");
  if (
    content.defaultChecklistRefs.length === 0 ||
    content.defaultChecklistRefs.some((ref) => !checklists.has(refKey(ref)))
  ) {
    throw new QaDomainError("QA_DEFAULT_CHECKLIST_NOT_ALLOWED");
  }
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(content),
    state: "PUBLISHED" as const,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function assertQaProjectContextScope(context: QaProjectContext, scope: QaScope): void {
  if (
    context.workspaceId !== scope.workspaceId ||
    context.projectId !== scope.projectId ||
    context.state !== "PUBLISHED"
  ) {
    throw new QaDomainError("QA_PROJECT_CONTEXT_SCOPE_MISMATCH");
  }
}

export function qaProjectContextRef(context: QaProjectContext) {
  return Object.freeze({
    id: context.contextId,
    version: context.version,
    contentHash: context.contentHash,
  });
}

export function publishQaProjectContextV2(content: QaProjectContextV2Content): QaProjectContextV2 {
  if (
    !content.contextId ||
    content.version < 1 ||
    !content.workspaceId ||
    !content.projectId ||
    content.resourceVersion < 1 ||
    !content.maximumClassificationKey ||
    Number.isNaN(Date.parse(content.publishedAt))
  ) {
    throw new QaDomainError("QA_PROJECT_CONTEXT_V2_INVALID");
  }
  const catalogs = [
    content.environmentRefs,
    content.testDataCatalogRefs,
    content.accountPoolRefs,
    content.targetPolicyRefs,
    content.scopePolicyRefs,
    content.checklistPolicyRefs,
  ];
  if (catalogs.some((catalog) => catalog.length === 0))
    throw new QaDomainError("QA_PROJECT_CONTEXT_V2_CATALOG_REQUIRED");
  const targetKeys = assertV2Catalog(content.targetPolicyRefs, "QA_TARGET_POLICY_CATALOG_INVALID");
  const scopeKeys = assertV2Catalog(content.scopePolicyRefs, "QA_SCOPE_POLICY_CATALOG_INVALID");
  const checklistKeys = assertV2Catalog(
    content.checklistPolicyRefs,
    "QA_CHECKLIST_POLICY_CATALOG_INVALID",
  );
  if (
    !targetKeys.has(v2RefKey(content.defaultTargetPolicyRef)) ||
    !scopeKeys.has(v2RefKey(content.defaultScopePolicyRef)) ||
    content.defaultChecklistRefs.length === 0 ||
    content.defaultChecklistRefs.some((ref) => !checklistKeys.has(v2RefKey(ref)))
  ) {
    throw new QaDomainError("QA_PROJECT_CONTEXT_V2_DEFAULT_NOT_ALLOWED");
  }
  for (const ref of [
    content.evidencePolicyRef,
    content.retentionPolicyRef,
    content.redactionPolicyRef,
    content.exportPolicyRef,
    content.riskReviewPolicyRef,
    content.dorRuleSetRef,
    content.dodRuleSetRef,
    content.capabilityRequirementSetRef,
  ]) {
    if (!immutableExternalRef(ref))
      throw new QaDomainError("QA_PROJECT_CONTEXT_V2_POLICY_REF_INVALID");
  }
  for (const catalog of catalogs) assertV2Catalog(catalog, "QA_PROJECT_CONTEXT_V2_CATALOG_INVALID");
  const body = Object.freeze({ schemaVersion: 2 as const, ...structuredClone(content) });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

function immutableExternalRef(ref: QaContextV2Ref): boolean {
  return (
    typeof ref.id === "string" &&
    ref.id.length > 0 &&
    /^sha256:[a-f0-9]{64}$/u.test(ref.contentHash) &&
    (typeof ref.version === "number"
      ? Number.isSafeInteger(ref.version) && ref.version > 0 && !("kind" in ref)
      : "kind" in ref &&
        typeof ref.kind === "string" &&
        ref.kind.length > 0 &&
        ref.version.length > 0)
  );
}
function v2RefKey(ref: QaContextV2Ref): string {
  return `${"kind" in ref ? ref.kind : ""}\0${ref.id}\0${typeof ref.version}:${ref.version}\0${ref.contentHash}`;
}
function assertV2Catalog(catalog: readonly QaContextV2Ref[], code: string): Set<string> {
  const keys = new Set(catalog.map(v2RefKey));
  if (keys.size !== catalog.length || catalog.some((ref) => !immutableExternalRef(ref)))
    throw new QaDomainError(code);
  return keys;
}
