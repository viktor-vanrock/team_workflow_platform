import type { AuthorizedProjectQueryToken } from "@awp/platform-core";

import type { AuthorizationCatalogEntry } from "./authorization-catalog.ts";
import type { AuthorizationContribution } from "./authorization-contributions.ts";

export const pilotAuthorizationCatalog: readonly AuthorizationCatalogEntry[] = Object.freeze([
  ...[
    ["readiness", "pilot.readiness.read"],
    ["health", "pilot.health.read"],
    ["deadLetters", "pilot.replay.read"],
    ["replayDecision", "pilot.replay.decide"],
    ["recoveryRun", "pilot.recovery.read"],
    ["run", "pilot.report.read"],
    ["metrics", "pilot.report.read"],
    ["measurementProtocol", "pilot.measurement.manage"],
    ["baselineImport", "pilot.measurement.manage"],
    ["review", "pilot.review.record"],
    ["evidenceImport", "pilot.evidence.import"],
  ].map(([method, permission]) =>
    Object.freeze({
      operation: `PilotController.${method}` as const,
      permission: permission!,
      surface: "CONFIGURATION" as const,
      scope: "PROJECT" as const,
    }),
  ),
  ...[
    ["deadLetters", "pilot.replay.read"],
    ["captureDiagnostics", "pilot.replay.decide"],
    ["replayDecision", "pilot.replay.decide"],
  ].map(([method, permission]) =>
    Object.freeze({
      operation: `PilotDeadLetterController.${method}` as const,
      permission: permission!,
      surface: "CONFIGURATION" as const,
      scope: "PROJECT" as const,
    }),
  ),
]);

const mutationPermissions = new Set([
  "pilot.replay.decide",
  "pilot.measurement.manage",
  "pilot.review.record",
  "pilot.evidence.import",
]);
export const pilotAuthorizationContribution = Object.freeze({
  componentRef: "core:pilot-authorization@1",
  matches: ({ permission }) => permission.startsWith("pilot."),
  authorize: async ({ context, permission, operation, resourceClassification }) => {
    const registered = pilotAuthorizationCatalog.some(
      (entry) => entry.permission === permission && entry.operation === operation,
    );
    if (
      !registered ||
      context.scope.kind !== "PROJECT" ||
      !context.scope.workspaceId ||
      !context.scope.projectId
    )
      return { allowed: false, reason: "INVALID_SCOPE" };
    if (resourceClassification.rank < 20)
      return { allowed: false, reason: "CLASSIFICATION_EXCEEDED" };
    if (mutationPermissions.has(permission) && context.actor.kind !== "HUMAN")
      return { allowed: false, reason: "NO_ROLE_PERMISSION" };
    // Base authorization has already checked live membership, entitlement, role and classification.
    return { allowed: true, reason: "ALLOW" };
  },
} satisfies AuthorizationContribution);

/** Call before repository access or aggregation; partial projections must be distinct reports. */
export function assertPilotReportScope(
  token: AuthorizedProjectQueryToken,
  workspaceId: string,
  projectIds: readonly string[],
  permission = "pilot.report.read",
): void {
  if (
    token.workspaceId !== workspaceId ||
    token.permission !== permission ||
    !projectIds.length ||
    projectIds.length > 100 ||
    new Set(projectIds).size !== projectIds.length
  )
    throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  for (const id of projectIds) token.assert(id, 20, "READ");
}
