import { deriveAgentGrants } from "@awp/platform-core";
import { loadEnvironment, localPersonaIds } from "@awp/runtime-composition";

import type { CoreAgentGrantAuthority } from "../extensions/core-intake-http-api.ts";

/** Historical local fixture grants; never a corporate grant resolver. */
export function createLocalAgentGrantAuthority(): CoreAgentGrantAuthority {
  const assertLocal = () => {
    if (!["local", "test"].includes(loadEnvironment().profile))
      throw new Error("LOCAL_AGENT_GRANTS_FORBIDDEN");
  };
  assertLocal();
  return {
    resolve: async ({ authorization, subject, skill }) => {
      assertLocal();
      return {
        servicePrincipalId: localPersonaIds["worker.local"],
        grants: deriveAgentGrants({
          subject,
          serviceCeiling: skill.actionAllowlist.map(({ action }) => action),
          skillAllowlist: skill.actionAllowlist,
          humanAllowedActions: skill.actionAllowlist.map(({ action }) => action),
          classificationCeiling:
            authorization.classificationCeiling === "PUBLIC" ? "PUBLIC" : "INTERNAL",
        }),
      };
    },
  };
}
