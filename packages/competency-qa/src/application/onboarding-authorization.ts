/** Pack-owned operations; the runtime composes these with the generic project catalog. */
export const qaOnboardingOperationCatalog = Object.freeze([
  ["publishProjectEnvironment", "qa.project-resource.manage", "PROJECT", "MUTATE", true, false],
  ["publishQaProjectContext", "qa.project-context.manage", "PROJECT", "MUTATE", true, false],
  ["publishQaProjectResource", "qa.project-resource.manage", "PROJECT", "MUTATE", true, false],
  ["acquireTestAccountLease", "qa.account-lease.acquire", "PROJECT", "MUTATE", false, false],
  ["releaseTestAccountLease", "qa.account-lease.release", "PROJECT", "MUTATE", false, false],
  ["verifyEvidenceManifest", "qa.evidence.verify", "PROJECT", "READ", false, false],
  ["getEvidencePackage", "qa.evidence.read", "PROJECT", "READ", false, false],
  ["exportEvidencePackage", "qa.evidence.export", "PROJECT", "MUTATE", true, true],
] as const);
