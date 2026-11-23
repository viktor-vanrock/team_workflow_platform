import type { DataSource } from "typeorm";

import {
  DurableQaCompletionRuntime,
  loadEnvironment,
  localSeedIds,
  type QaDodRuntime,
  qaJiraLocalSeedRefs,
  qaLocalSeedIds,
} from "@awp/runtime-composition";

/** Historical local projection/profile compatibility is confined to this explicitly selected adapter. */
export function createLocalQaCompletionRuntime(
  source: DataSource,
  dod: QaDodRuntime,
): DurableQaCompletionRuntime {
  const local = () => {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QA_COMPLETION_FORBIDDEN");
  };
  local();
  return new DurableQaCompletionRuntime(source, dod, {
    load: async (manager, scope, workItemId) => {
      local();
      if (
        scope.workspaceId !== localSeedIds.workspaceFunctional ||
        scope.projectId !== localSeedIds.alpha
      )
        throw new Error("LOCAL_QA_COMPLETION_SCOPE_DENIED");
      const [input] = (await manager.query(
        "SELECT i.external_request_id,i.external_request_version FROM qa_request_extensions e JOIN qa_request_input_revisions i ON i.input_revision_id=e.current_input_revision_id AND i.workspace_id=e.workspace_id AND i.project_id=e.project_id AND i.work_item_id=e.work_item_id WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.work_item_id=$3",
        [scope.workspaceId, scope.projectId, workItemId],
      )) as { external_request_id: string; external_request_version: string }[];
      if (!input) throw new Error("QA_COMPLETION_CANDIDATE_NOT_FOUND");
      const [observed] = (await manager.query(
        "SELECT result FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND operation='request.transition' AND state='CONFIRMED' AND result->>'normalizedStatus'='READY' AND payload->'metadata'->'source'->>'sourceWorkItemId'=$3 ORDER BY created_at DESC LIMIT 1",
        [scope.workspaceId, scope.projectId, workItemId],
      )) as { result: { externalVersion: string } }[];
      const jira = loadEnvironment().composition === "qa-jira-local";
      const bindingRef = jira
        ? qaJiraLocalSeedRefs.binding
        : { id: qaLocalSeedIds.alphaBinding, version: 4 };
      const profileRef = jira
        ? qaJiraLocalSeedRefs.profile
        : { id: qaLocalSeedIds.profile, version: 4 };
      return {
        bindingRef,
        profileRef,
        profileRefs: [profileRef],
        authorityScopeKey: "qa.alpha",
        maximumClassificationKey: "INTERNAL",
        allowedDataClassifications: ["PUBLIC", "INTERNAL"],
        configurationChain: [{ logicalRole: "QA_REQUEST_AUTHORITY", profileRef }],
        projection: {
          externalEntityId: input.external_request_id,
          normalizedStatus: "READY",
          externalVersion: observed?.result.externalVersion ?? input.external_request_version,
        },
      };
    },
  });
}
