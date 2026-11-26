import type { CompetencyPackManifest, WorkTypeDefinition } from "@awp/competency-sdk";

import { qaCompetencyManifestV14, qaValidationWorkTypeDefinitionV14 } from "./manifest-v1.4.ts";

/** Versioned separately: previously published manifests retain their original environment limits. */
export const qaValidationWorkTypeDefinitionV15 = Object.freeze({
  ...qaValidationWorkTypeDefinitionV14,
  definitionVersion: "1.5.0",
  capabilityRequirements: Object.freeze(
    qaValidationWorkTypeDefinitionV14.capabilityRequirements.map((requirement) =>
      requirement.capabilityKey === "operational-work-item" ||
      requirement.capabilityKey.startsWith("messaging.")
        ? Object.freeze({
            ...requirement,
            allowedEnvironmentScopes: Object.freeze(["LOCAL", "NON_PRODUCTION"] as const),
          })
        : requirement,
    ),
  ),
} as const satisfies WorkTypeDefinition);

export const qaCompetencyManifestV15 = Object.freeze({
  ...qaCompetencyManifestV14,
  metadata: Object.freeze({
    ...qaCompetencyManifestV14.metadata,
    version: "1.5.0",
    displayName: "QA Competency Pack for non-production integrations",
  }),
  workTypes: Object.freeze([qaValidationWorkTypeDefinitionV15]),
} as const satisfies CompetencyPackManifest);
