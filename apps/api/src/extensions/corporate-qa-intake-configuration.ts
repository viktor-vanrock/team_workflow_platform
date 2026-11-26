import type { confirmQaIntake } from "@awp/competency-qa/node";
import {
  deriveQaJiraRequestCreateCommandIdentity,
  assertCurrentQaOperationalConfiguration,
  integrationConfigurationHash,
  resolvePublishedQaProjectConfiguration,
  resolveQaJiraRequestCreateConfiguration,
  TypeOrmProjectEffectGuard,
  type QaReadinessPins,
  type RuntimeEnvironment,
} from "@awp/runtime-composition";
import type { DataSource } from "typeorm";

import type { QaIntakeConfiguration } from "./qa-intake-configuration.ts";

/** Requires a server-owned channel resolver; no local users or fixture channels are used. */
export function createCorporateQaIntakeConfiguration(
  source: DataSource,
  environment: RuntimeEnvironment,
  responseChannels: Parameters<typeof confirmQaIntake>[0]["responseChannels"],
  projectPins: readonly QaReadinessPins[],
): QaIntakeConfiguration {
  if (
    environment.profile !== "non-local" ||
    !environment.deployment ||
    !responseChannels?.resolve ||
    !Array.isArray(projectPins)
  )
    throw new Error("CORPORATE_QA_CONFIGURATION_REQUIRED");
  const deployment = environment.deployment;
  return {
    async load(scope) {
      if (
        scope.workspaceId !== deployment.workspaceId ||
        !deployment.projectIds.includes(scope.projectId)
      )
        throw new Error("QA_SCOPE_DENIED");
      const selected = await resolvePublishedQaProjectConfiguration(source, scope);
      await new TypeOrmProjectEffectGuard(source).assertEffectsAllowed(scope);
      const pin = projectPins.find(
        (value) => value.workspaceId === scope.workspaceId && value.projectId === scope.projectId,
      );
      if (
        !pin ||
        selected.bindingRef.id !== pin.bindingRef.id ||
        selected.bindingRef.version !== pin.bindingRef.version ||
        selected.profileRef.id !== pin.profileRef.id ||
        selected.profileRef.version !== pin.profileRef.version ||
        selected.projectContextId !== pin.contextRef.id ||
        selected.authorityScopeKey !== pin.authorityScopeKey
      )
        throw new Error("QA_PROJECT_CONFIGURATION_NOT_APPROVED");
      await assertCurrentQaOperationalConfiguration(source, pin);
      const contexts = (await source.query(
        `SELECT r.version,r.content_hash FROM qa_project_contexts h JOIN qa_project_context_versions r ON r.id=h.current_published_version_id AND r.workspace_id=h.workspace_id AND r.project_id=h.project_id
         WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.id=$3`,
        [scope.workspaceId, scope.projectId, pin.contextRef.id],
      )) as { version: number; content_hash: string }[];
      if (
        contexts.length !== 1 ||
        contexts[0]!.version !== pin.contextRef.version ||
        contexts[0]!.content_hash !== pin.contextRef.contentHash
      )
        throw new Error("QA_PROJECT_CONTEXT_NOT_APPROVED");
      return {
        ...selected,
        responseChannels,
        async commandIdentity(input) {
          await new TypeOrmProjectEffectGuard(source).assertEffectsAllowed(scope);
          const pins = await resolveQaJiraRequestCreateConfiguration(source, {
            ...scope,
            bindingRef: selected.bindingRef,
            profileRef: selected.profileRef,
            environment,
          });
          for (const entry of pins.entries) {
            for (const [kind, ref] of [
              ["connector_profile", entry.pin.profileRef],
              ["connector_mapping", entry.pin.mappingRef],
              ["connection", entry.pin.connectionRef],
            ] as const) {
              const rows = (await source.query(
                `SELECT r.content,r.content_hash FROM ${kind}_headers h JOIN ${kind}_revisions r
                 ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version
                 WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
                [scope.workspaceId, ref.id, ref.version],
              )) as { content: Record<string, unknown>; content_hash: string }[];
              if (
                rows.length !== 1 ||
                integrationConfigurationHash(kind, rows[0]!.content) !== rows[0]!.content_hash
              )
                throw new Error("QA_PROJECT_CONFIGURATION_NOT_CURRENT");
            }
          }
          return deriveQaJiraRequestCreateCommandIdentity({ ...input, pins: pins.pinSet });
        },
      };
    },
  };
}
