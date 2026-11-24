import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import {
  assertExactRevisionRef,
  canonicalSet,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  onboardingContentHash,
  ProjectOnboardingError,
  type ProjectScope,
} from "../project-onboarding/primitives.ts";

export interface ProjectEntitlementRevision extends ProjectScope {
  readonly revisionId: string;
  readonly entitlementId: string;
  readonly version: number;
  readonly principalId: string;
  readonly operation: "GRANT" | "REPLACE" | "REVOKE";
  readonly effect: "ALLOW" | "DENY";
  readonly permissions: readonly string[];
  readonly classificationCeilingKey: string;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly revokedAt?: string;
  readonly previousRevisionRef?: ExactRevisionRef;
  readonly actor:
    HumanActorSnapshot | Readonly<{ kind: "SERVICE"; principalId: string; serviceKey: string }>;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
}

export function createProjectEntitlementRevision(
  input: Omit<ProjectEntitlementRevision, "permissions" | "contentHash"> & {
    readonly permissions: readonly string[];
  },
): ProjectEntitlementRevision {
  if (
    !input.revisionId ||
    !input.entitlementId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.principalId ||
    input.version < 1 ||
    !input.reason
  ) {
    throw new ProjectOnboardingError("PROJECT_ENTITLEMENT_REVISION_INVALID");
  }
  if (input.version === 1 && input.previousRevisionRef !== undefined)
    throw new ProjectOnboardingError("ENTITLEMENT_PREDECESSOR_FORBIDDEN");
  if (input.version > 1) {
    if (!input.previousRevisionRef)
      throw new ProjectOnboardingError("ENTITLEMENT_PREDECESSOR_REQUIRED");
    assertExactRevisionRef(input.previousRevisionRef);
    if (input.previousRevisionRef.version !== input.version - 1)
      throw new ProjectOnboardingError("ENTITLEMENT_PREDECESSOR_MISMATCH");
  }
  if (input.operation === "REVOKE" && !input.revokedAt)
    throw new ProjectOnboardingError("ENTITLEMENT_REVOKED_AT_REQUIRED");
  const permissions = canonicalSet(input.permissions);
  if (permissions.length === 0) throw new ProjectOnboardingError("ENTITLEMENT_PERMISSION_REQUIRED");
  for (const value of [input.validFrom, input.validUntil, input.revokedAt, input.createdAt]) {
    if (value !== undefined && Number.isNaN(Date.parse(value)))
      throw new ProjectOnboardingError("ENTITLEMENT_TIMESTAMP_INVALID");
  }
  const body = { ...structuredClone(input), permissions };
  return Object.freeze({
    ...body,
    contentHash: onboardingContentHash(body as unknown as JsonValue),
  });
}

export function entitlementSetHash(revisions: readonly ProjectEntitlementRevision[]): Sha256Digest {
  const current = revisions
    .filter((revision) => revision.operation !== "REVOKE")
    .map(({ entitlementId, version, contentHash }) => ({ entitlementId, version, contentHash }))
    .sort((a, b) => a.entitlementId.localeCompare(b.entitlementId));
  return onboardingContentHash(current as unknown as JsonValue);
}
