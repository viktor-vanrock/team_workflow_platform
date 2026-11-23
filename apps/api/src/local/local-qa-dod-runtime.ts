import type { DataSource } from "typeorm";

import {
  DurableQaDodRuntime,
  DurableQaVerdictRuntime,
  localSeedIds,
  type QaDodPolicyPort,
} from "@awp/runtime-composition";

/** Local fixtures use historical policy references; the inventory still comes from persisted records. */
export function createLocalQaDodPolicy(): QaDodPolicyPort {
  const local = () => {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QA_DOD_FORBIDDEN");
  };
  local();
  return {
    load: async (_manager, scope, extension) => {
      local();
      if (
        scope.workspaceId !== localSeedIds.workspaceFunctional ||
        scope.projectId !== localSeedIds.alpha
      )
        throw new Error("LOCAL_QA_DOD_SCOPE_DENIED");
      if (
        extension.dodRuleSetRef.key !== "qa.dod" ||
        extension.dodRuleSetRef.version !== "1.0.0" ||
        extension.evidencePolicyRef.key !== "qa.evidence" ||
        extension.evidencePolicyRef.version !== "1.0.0"
      )
        throw new Error("QA_DOD_POLICY_UNSUPPORTED");
      return {
        rules: {
          id: extension.dodRuleSetRef.key,
          version: 1,
          contentHash: extension.dodRuleSetRef.contentHash,
        },
        riskPolicyRef: extension.riskReviewPolicyRef,
        evidencePolicyRef: extension.evidencePolicyRef,
        minimumEffectiveRisk: "ORDINARY",
        maximumClassificationKey: "INTERNAL",
      };
    },
  };
}

export function createLocalQaDodRuntime(source: DataSource): DurableQaDodRuntime {
  return new DurableQaDodRuntime(source, createLocalQaDodPolicy());
}
export function createLocalQaVerdictRuntime(source: DataSource): DurableQaVerdictRuntime {
  return new DurableQaVerdictRuntime(source, createLocalQaDodPolicy());
}
