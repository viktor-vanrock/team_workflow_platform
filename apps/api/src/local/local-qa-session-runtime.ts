import {
  qaLocalSeedIds,
  type QaSessionRuntime,
  RuntimeQaManualSessionAdmissionAdapter,
} from "@awp/runtime-composition";

import { onboardingSessionProfiles } from "../extensions/onboarding/session-facts.ts";

/** Compatibility for explicit local/test compositions only. */
export function createLocalQaSessionRuntime(): QaSessionRuntime {
  const local = () => {
    if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
      throw new Error("LOCAL_QA_SESSION_RUNTIME_FORBIDDEN");
  };
  local();
  return {
    profiles: async (source, authority, binding, permission) => {
      local();
      await authority.authorize(permission);
      return (
        (await onboardingSessionProfiles(source, authority, binding)) ?? [
          { id: qaLocalSeedIds.profile, version: 2 },
        ]
      );
    },
    admission: (manager, context) => ({
      admit: async (previous, next) => {
        local();
        const authorization = await context.authorize("qa.session.execute");
        if (process.env.AWP_QUEUE_STATIC_CONTOUR !== "true")
          return Object.freeze({ outcome: "ADMITTED" });
        return new RuntimeQaManualSessionAdmissionAdapter(manager, {
          actor: authorization.actor,
          authorizationBasis: authorization.basis,
          correlationId: context.correlationId,
          causationId: context.causationId,
          ...(context.overrideIntent ? { overrideIntent: context.overrideIntent } : {}),
        }).admit(previous, next);
      },
    }),
  };
}
