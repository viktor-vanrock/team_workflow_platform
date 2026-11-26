export interface OnboardingOperationAuthorization {
  readonly operation: string;
  readonly permission: string;
  readonly scope: "PROJECT" | "WORKSPACE_PROJECT_CATALOG";
  readonly actionClass: "READ" | "MUTATE" | "PLATFORM_ACTION" | "CAPABILITY_REDUCING";
  readonly requiresHuman: boolean;
  readonly stepUpRequired: boolean;
}

export const onboardingOperationCatalog: readonly OnboardingOperationAuthorization[] =
  Object.freeze(
    [
      [
        "listAuthorizedProjects",
        "project.catalog.read",
        "WORKSPACE_PROJECT_CATALOG",
        "READ",
        false,
        false,
      ],
      ["registerProject", "project.register", "WORKSPACE_PROJECT_CATALOG", "MUTATE", true, true],
      ["getProjectOnboarding", "project.onboarding.read", "PROJECT", "READ", false, false],
      [
        "evaluateProjectOnboarding",
        "project.onboarding.evaluate",
        "PROJECT",
        "MUTATE",
        true,
        false,
      ],
      [
        "activateProjectPilot",
        "project.onboarding.activate",
        "PROJECT",
        "PLATFORM_ACTION",
        true,
        true,
      ],
      ["grantProjectEntitlement", "project.entitlement.manage", "PROJECT", "MUTATE", true, true],
      ["revokeProjectEntitlement", "project.entitlement.manage", "PROJECT", "MUTATE", true, true],
      ["validateBinding", "integration.validate", "PROJECT", "MUTATE", true, false],
      ["acceptBindingFunctionally", "integration.accept", "PROJECT", "MUTATE", true, false],
      [
        "applyBindingLifecycleAction",
        "integration.publish",
        "PROJECT",
        "PLATFORM_ACTION",
        true,
        true,
      ],
      ["emergencySuspendProject", "project.suspend", "PROJECT", "CAPABILITY_REDUCING", true, true],
      ["resumeProject", "project.resume", "PROJECT", "PLATFORM_ACTION", true, true],
    ].map(([operation, permission, scope, actionClass, requiresHuman, stepUpRequired]) =>
      Object.freeze({
        operation,
        permission,
        scope,
        actionClass,
        requiresHuman,
        stepUpRequired,
      }),
    ) as readonly OnboardingOperationAuthorization[],
  );

export const projectActionPermissionByKind = Object.freeze({
  BINDING_PUBLISH: "integration.publish",
  BINDING_RETIRE: "integration.retire",
  PROJECT_RESUME: "project.resume",
  ONBOARDING_PILOT_ACTIVATE: "project.onboarding.activate",
  PILOT_FENCE_PUBLISH: "project.onboarding.activate",
} as const);
