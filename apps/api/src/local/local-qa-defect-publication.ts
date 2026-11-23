import type { DataSource } from "typeorm";

import {
  DurableQaDefectPublicationRuntime,
  loadEnvironment,
  localSeedIds,
  qaJiraLocalBaseSeedRefs,
  qaJiraLocalSeedRefs,
  qaLocalSeedIds,
} from "@awp/runtime-composition";

/** Explicit local compatibility; corporate deployments must inject published project configuration. */
export function createLocalQaDefectPublication(
  source: DataSource,
): DurableQaDefectPublicationRuntime {
  const local = () => {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QA_DEFECT_PUBLICATION_FORBIDDEN");
  };
  local();
  return new DurableQaDefectPublicationRuntime(source, {
    load: async (_manager, scope) => {
      local();
      if (
        scope.workspaceId !== localSeedIds.workspaceFunctional ||
        scope.projectId !== localSeedIds.alpha
      )
        throw new Error("LOCAL_QA_DEFECT_SCOPE_DENIED");
      const jira = loadEnvironment().composition === "qa-jira-local";
      const bindingRef = jira
        ? qaJiraLocalSeedRefs.binding
        : { id: qaLocalSeedIds.alphaBinding, version: 3 };
      const profileRef = jira
        ? qaJiraLocalBaseSeedRefs.profile
        : { id: qaLocalSeedIds.profile, version: 3 };
      const profileRefs = jira ? [profileRef, qaJiraLocalSeedRefs.profile] : [profileRef];
      return {
        bindingRef,
        profileRef,
        profileRefs,
        authorityScopeKey: "qa.alpha",
        maximumClassificationKey: "INTERNAL",
        allowedDataClassifications: ["PUBLIC", "INTERNAL"],
        ...(jira
          ? { externalTarget: { externalProjectId: "200", externalIssueTypeId: "10002" } }
          : {}),
        configurationChain: [
          { logicalRole: "DEFECT_DESTINATION", profileRef },
          ...(jira
            ? [{ logicalRole: "QA_REQUEST_AUTHORITY", profileRef: qaJiraLocalSeedRefs.profile }]
            : []),
        ],
      };
    },
  });
}
