import type { DataSource } from "typeorm";

import { QaProjectPolicyRepository, QaUs2RetestLineageResolver } from "@awp/competency-qa/node";
import {
  currentQaRequesterEntitlement,
  DurableQaReadinessRuntime,
  qaLocalFixtureCatalog,
  qaLocalSeedIds,
} from "@awp/runtime-composition";

export function createLocalQaReadinessRuntime(source: DataSource) {
  const local = () => {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QA_READINESS_FORBIDDEN");
  };
  local();
  return new DurableQaReadinessRuntime(
    source,
    {
      load: async (manager, extension, current) => {
        local();
        const context = await new QaProjectPolicyRepository(manager).currentProjectContext(
          extension,
          extension.projectContextRef.id,
        );
        if (!context) throw new Error("QA_PROJECT_CONTEXT_NOT_FOUND");
        const [project] = (await manager.query(
          "SELECT key,state FROM projects WHERE workspace_id=$1 AND id=$2",
          [extension.workspaceId, extension.projectId],
        )) as { key: keyof typeof qaLocalFixtureCatalog.projectRegistry; state: string }[];
        if (!project || !Object.hasOwn(qaLocalFixtureCatalog.projectRegistry, project.key))
          throw new Error("LOCAL_QA_READINESS_PROJECT_UNKNOWN");
        return {
          authorityScopeKey: `qa.${project.key.toLowerCase()}`,
          acceptedRequest: {
            exists: true,
            externalVersion: current.externalRequestRef.version,
            normalizedStatus: "NEW",
          },
          project: {
            state: project.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
            registryState: qaLocalFixtureCatalog.projectRegistry[project.key],
            registryRevision: 1,
          },
          requesterEntitlement: await currentQaRequesterEntitlement(source, current),
          mappingHealth: {
            valid: true,
            bindingRef: current.operationalBindingRef,
            profileRef: { id: qaLocalSeedIds.profile, version: 2 },
          },
          contextRef: extension.projectContextRef,
          dorRuleSetRef: extension.dorRuleSetRef,
          allowedEnvironmentRefs: context.allowedEnvironments,
          maximumClassificationKey: context.maximumClassificationKey,
        };
      },
    },
    new QaUs2RetestLineageResolver(),
  );
}
