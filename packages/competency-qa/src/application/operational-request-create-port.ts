/**
 * Pack-owned structural view of the capability it requires. The Connector SDK owns the
 * executable adapter contract; the QA Pack deliberately does not depend on that runtime SDK.
 */
export interface QaOperationalRequestCreateTarget {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityKind: "REQUEST";
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
}

export interface QaOperationalRequestCreateInput {
  readonly sourceDraftId: string;
  readonly workTypeKey: "qa.validation";
  readonly workTypeVersion: "1.0.0";
  readonly requestKind: "feature-validation" | "smoke" | "regression" | "retest" | "investigation";
  readonly summary: string;
  readonly description?: string;
  readonly acceptanceOutcome?: string;
  readonly sourceRefs?: readonly Readonly<{
    kind: string;
    id: string;
    version: string;
    contentHash: `sha256:${string}`;
  }>[];
  readonly requestedNormalizedStatus: "NEW";
  readonly dataClassificationKey: string;
}

export interface QaOperationalRequestCreateResult {
  readonly operation: "request.create";
  readonly entityKind: "REQUEST";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: string;
  readonly normalizedStatus: "NEW";
  readonly naturalKey: string;
  readonly effectId: string;
  readonly observedAt: string;
}
