import type { CompetencyPackManifest } from "@awp/competency-sdk";

/** Statically registered only by the local composition. No Jira-owned operational actions. */
export const techWritingManifest = Object.freeze({
  apiVersion: "awp.platform/v1",
  kind: "CompetencyPack",
  metadata: { key: "tech-writing", version: "1.0.0", displayName: "Техническая документация" },
  requires: { coreContracts: ">=1.0.0 <2.0.0", competencySdk: ">=1.0.0 <2.0.0" },
  events: [],
  workTypes: [
    {
      key: "tech-writing.service-documentation",
      definitionVersion: "1.0.0",
      displayName: "Документация сервиса",
      intakeSchemaRef: {
        id: "urn:awp:schemas:tech-writing:intake:v1",
        version: 1,
        digest: "sha256:9e9ed4fcf13712347269570d86811b959ea028d122c93299677f36ef0050c281",
      },
      applicationComponentRef: "tech-writing.local.application",
      migrationNamespace: "tech-writing",
      uiContributions: [],
      capabilityRequirements: [],
    },
  ],
} as const satisfies CompetencyPackManifest);
