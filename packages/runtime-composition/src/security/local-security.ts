import type { RuntimeProfile } from "../config/environment.ts";
import { workspaceRolePermissions } from "./workspace-role-catalog.ts";

interface LocalPersona {
  readonly key: string;
  readonly label: string;
  readonly subject: string;
  readonly kind: "HUMAN" | "SERVICE";
  readonly workspaceKey: "local-functional" | "local-isolated" | "local-tech-writing";
  readonly projectKey?: "ALPHA" | "BETA" | "DELTA" | "ALPHA-DOCS";
  readonly sharedTeam?: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly classificationCeiling: "PUBLIC" | "INTERNAL" | "RESTRICTED";
}

const personas = Object.freeze([
  {
    key: "superadmin.local",
    label: "Суперадминистратор",
    subject: "superadmin.local",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["super-administrator"],
    permissions: workspaceRolePermissions("super-administrator"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "owner.local",
    label: "Администратор · 1",
    subject: "owner.local",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["system-administrator"],
    permissions: workspaceRolePermissions("system-administrator"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "integration-admin.alpha",
    label: "Администратор · 2",
    subject: "integration-admin.alpha",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["system-administrator"],
    permissions: workspaceRolePermissions("system-administrator"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "requester.alpha",
    label: "Requester",
    subject: "requester.alpha",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: false,
    projectKey: "ALPHA",
    roles: ["requester"],
    permissions: workspaceRolePermissions("requester"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "executor.alpha",
    label: "QA Executor · QA 1",
    subject: "executor.alpha",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["qa-executor"],
    permissions: workspaceRolePermissions("qa-executor"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "executor.qa2",
    label: "QA Executor · QA 2",
    subject: "executor.qa2",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["qa-executor"],
    permissions: workspaceRolePermissions("qa-executor"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "lead.alpha",
    label: "QA Lead",
    subject: "lead.alpha",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "ALPHA",
    roles: ["qa-lead"],
    permissions: workspaceRolePermissions("qa-lead"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "viewer.beta",
    label: "Читатель",
    subject: "viewer.beta",
    kind: "HUMAN",
    workspaceKey: "local-functional",
    sharedTeam: true,
    projectKey: "BETA",
    roles: ["reader"],
    permissions: workspaceRolePermissions("reader"),
    classificationCeiling: "RESTRICTED",
  },
  {
    key: "worker.local",
    label: "Worker Service",
    subject: "worker.local",
    kind: "SERVICE",
    workspaceKey: "local-functional",
    projectKey: "ALPHA",
    roles: ["worker"],
    permissions: ["command.execute", "work-item.read"],
    classificationCeiling: "INTERNAL",
  },
  {
    key: "writer.docs",
    label: "Технический писатель",
    subject: "writer.docs",
    kind: "HUMAN",
    workspaceKey: "local-tech-writing",
    projectKey: "ALPHA-DOCS",
    roles: ["technical-writer"],
    permissions: workspaceRolePermissions("technical-writer"),
    classificationCeiling: "INTERNAL",
  },
  {
    key: "lead.docs",
    label: "Лид технических писателей",
    subject: "lead.docs",
    kind: "HUMAN",
    workspaceKey: "local-tech-writing",
    projectKey: "ALPHA-DOCS",
    roles: ["technical-writing-lead"],
    permissions: workspaceRolePermissions("technical-writing-lead"),
    classificationCeiling: "INTERNAL",
  },
] as const satisfies readonly LocalPersona[]);

export const localPersonaCatalog = Object.freeze({
  publicOptions: (): readonly Readonly<{ key: string; label: string }>[] =>
    personas
      .filter(({ kind }) => kind === "HUMAN")
      .map(({ key, label }) => Object.freeze({ key, label })),
  seedOptions: (): readonly Readonly<{ key: string; label: string }>[] =>
    personas.map(({ key, label }) => Object.freeze({ key, label })),
  resolve: (key: string): LocalPersona => {
    const persona = personas.find((candidate) => candidate.key === key);
    if (!persona) throw new Error("LOCAL_PERSONA_UNKNOWN");
    return persona;
  },
});

const localServiceNames = Object.freeze(["fake-idp", "mock-hub", "postgres"] as const);
export const localContainerEgressPolicy = Object.freeze({
  allowedServices: localServiceNames,
  canReach: (source: "api" | "worker", destination: string): boolean =>
    (source === "api" || source === "worker") &&
    localServiceNames.includes(destination as (typeof localServiceNames)[number]),
});

function localEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return ["mock-hub", "fake-idp", "localhost", "127.0.0.1"].includes(url.hostname);
}

const queueLocalEndpointHosts = new Set([
  "mock-hub",
  "fake-idp",
  "postgres",
  "localhost",
  "127.0.0.1",
]);

/** Rejects production-looking authority and non-local URLs before queue adapters can resolve credentials. */
export function assertQueueLocalProductionBoundary(
  source: Readonly<Record<string, string | undefined>>,
): void {
  for (const [key, raw] of Object.entries(source)) {
    const value = raw?.trim();
    if (!value) continue;
    if (
      /^AWP_.*(?:PRODUCTION|PROD).*(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|ENDPOINT|URL)$/u.test(key)
    ) {
      throw new Error("QUEUE_LOCAL_PRODUCTION_AUTHORITY_FORBIDDEN");
    }
    if (/^AWP_.*(?:URL|ENDPOINT)$/u.test(key)) {
      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        throw new Error("QUEUE_LOCAL_ENDPOINT_INVALID");
      }
      if (!queueLocalEndpointHosts.has(endpoint.hostname))
        throw new Error("QUEUE_LOCAL_EXTERNAL_ENDPOINT_FORBIDDEN");
    }
  }
}

export function assertLocalSecretsAllowed(
  profile: RuntimeProfile,
  source: Readonly<Record<string, string | undefined>>,
): void {
  if (profile === "local" || profile === "test") return;
  const fakeSecret = Object.entries(source).some(
    ([key, value]) =>
      value !== undefined &&
      /SECRET|PASSWORD|ACCESS_KEY/u.test(key) &&
      /local|fake|test/u.test(value),
  );
  if (fakeSecret) throw new Error("FAKE_SECRET_FORBIDDEN_OUTSIDE_LOCAL");
}

export function assertConnectionEndpointAllowed<T>(
  profile: RuntimeProfile,
  endpoint: string,
  persist?: () => T,
): T | undefined {
  if (profile !== "local" && profile !== "test" && localEndpoint(endpoint))
    throw new Error("NON_LOCAL_CONNECTION_ENDPOINT_FORBIDDEN");
  if ((profile === "local" || profile === "test") && !localEndpoint(endpoint))
    throw new Error("LOCAL_CONNECTION_ENDPOINT_FORBIDDEN");
  return persist?.();
}

export function assertEffectEndpointAllowed<T>(
  profile: RuntimeProfile,
  endpoint: string,
  invoke?: () => T,
): T | undefined {
  if (profile !== "local" && profile !== "test" && localEndpoint(endpoint))
    throw new Error("NON_LOCAL_EFFECT_ENDPOINT_FORBIDDEN");
  if ((profile === "local" || profile === "test") && !localEndpoint(endpoint))
    throw new Error("LOCAL_EFFECT_ENDPOINT_FORBIDDEN");
  return invoke?.();
}

export function assertLocalEvidenceSignerIsolation(
  profile: RuntimeProfile,
  kid: string,
  privateMaterialPresent: boolean,
): void {
  if (privateMaterialPresent && profile !== "local" && profile !== "test")
    throw new Error("LOCAL_EVIDENCE_SIGNER_PRIVATE_KEY_FORBIDDEN");
  if ((profile === "local" || profile === "test") && !/^local-ed25519:[1-9][0-9]*$/u.test(kid))
    throw new Error("LOCAL_EVIDENCE_SIGNER_KEY_ID_INVALID");
}

export function assertOnboardingLocalSecurityBoundary(
  source: Readonly<Record<string, string | undefined>>,
): void {
  if (
    source.AWP_ENVIRONMENT !== "LOCAL" ||
    source.AWP_RUNTIME_PROFILE !== "local" ||
    source.AWP_COMPOSITION !== "qa-jira-gitlab-mattermost-local" ||
    source.AWP_EXTERNAL_NETWORK_MODE !== "deny" ||
    source.AWP_ONBOARDING_STATIC_CONTOUR !== "true"
  )
    throw new Error("ONBOARDING_LOCAL_STATIC_CONTOUR_REQUIRED");
  assertQueueLocalProductionBoundary(source);
  assertLocalEvidenceSignerIsolation(
    "local",
    source.AWP_EVIDENCE_SIGNER_KID ?? "",
    source.AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL === "true",
  );
}
