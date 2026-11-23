import { createHash } from "node:crypto";

export const onboardingFixture = Object.freeze({
  now: "2026-09-03T12:00:00.000Z",
  later: "2026-09-03T13:00:00.000Z",
  workspaceId: "00000000-0000-4000-8000-000000000701",
  projectA: "00000000-0000-4000-8000-000000000711",
  projectB: "00000000-0000-4000-8000-000000000712",
  forbiddenProjectC: "00000000-0000-4000-8000-000000000713",
  accessMatrix: Object.freeze({
    principals: Object.freeze([
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000723",
        role: "qa-lead",
        visibleProjects: Object.freeze([
          "00000000-0000-4000-8000-000000000711",
          "00000000-0000-4000-8000-000000000712",
        ]),
        classificationCeilingRank: 20,
      }),
      Object.freeze({
        id: "00000000-0000-4000-8000-000000000724",
        role: "qa-engineer",
        visibleProjects: Object.freeze(["00000000-0000-4000-8000-000000000711"]),
        classificationCeilingRank: 10,
      }),
    ]),
    classifications: Object.freeze([
      { key: "INTERNAL", rank: 10 },
      { key: "RESTRICTED", rank: 20 },
    ]),
  }),
  integrationAdministratorId: "00000000-0000-4000-8000-000000000721",
  workspaceOwnerId: "00000000-0000-4000-8000-000000000722",
  qaLeadId: "00000000-0000-4000-8000-000000000723",
  qaEngineerId: "00000000-0000-4000-8000-000000000724",
  serviceId: "00000000-0000-4000-8000-000000000725",
  correlationId: "correlation-007-foundation",
  classification: Object.freeze({ key: "INTERNAL", rank: 20, catalogVersion: 1 }),
  signingKey: Object.freeze({
    kid: "local-ed25519:1",
    version: 1,
    publicJwk: Object.freeze({
      kty: "OKP",
      crv: "Ed25519",
      x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    }),
    privateJwk: Object.freeze({
      kty: "OKP",
      crv: "Ed25519",
      x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
    }),
  }),
});

export function testHash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function exactRef(id: string, version = 1) {
  return Object.freeze({ id, version, contentHash: testHash({ id, version }) });
}

export function humanActor(principalId: string = onboardingFixture.qaLeadId, roleKey = "qa-lead") {
  return Object.freeze({
    kind: "HUMAN" as const,
    principalId,
    roleKey,
    authorizationBasisRef: exactRef(`basis-${principalId}`),
    authenticationContextRef: exactRef(`authn-${principalId}`),
  });
}

export function projectScope(projectId: string = onboardingFixture.projectA) {
  return Object.freeze({ workspaceId: onboardingFixture.workspaceId, projectId });
}

export function projectFixture(projectId: string = onboardingFixture.projectA): Readonly<{
  workspaceId: string;
  projectId: string;
  key: string;
  name: string;
  authorization: "ALLOWED" | "FORBIDDEN";
}> {
  const suffix =
    projectId === onboardingFixture.projectA
      ? "a"
      : projectId === onboardingFixture.projectB
        ? "b"
        : "c";
  return Object.freeze({
    ...projectScope(projectId),
    key: `project-${suffix}`,
    name: `Project ${suffix.toUpperCase()}`,
    authorization: projectId === onboardingFixture.forbiddenProjectC ? "FORBIDDEN" : "ALLOWED",
  });
}

export function qaHumanActor(principalId: string = onboardingFixture.qaLeadId) {
  return Object.freeze({
    kind: "HUMAN" as const,
    principalId,
    issuer: "https://fixture.example.test",
    subject: principalId,
  });
}
