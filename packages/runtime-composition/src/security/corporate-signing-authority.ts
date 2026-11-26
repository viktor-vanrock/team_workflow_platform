import type { DataSource } from "typeorm";

import type { QaEvidenceManifestRevisionV2 } from "@awp/competency-qa";
import {
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
} from "@awp/platform-core";
import {
  RuntimeConfigurationRepository,
  TypeOrmCorporateScopedAccessRepository,
  TypeOrmIdentityRepository,
} from "@awp/platform-persistence-typeorm";

import type { CorporateSigningConfiguration } from "./corporate-evidence-signing.ts";

export interface CorporateSigningGrant {
  readonly configuration: CorporateSigningConfiguration;
  readonly serviceIdentity: Readonly<{ issuer: string; subject: string; serviceKey: string }>;
  readonly permission: string;
}

/** A signer can only act with current Core SERVICE rights and current published signing policy. */
export function createCorporateSigningAuthority(
  source: DataSource,
  policyRef: ExactRevisionRef,
  input: readonly CorporateSigningGrant[],
) {
  if (!source.isInitialized || !input.length || input.length > 100)
    throw new Error("CORPORATE_SIGNING_AUTHORITY_CONFIGURATION_INVALID");
  policyRef = freezePilotValue(structuredClone(policyRef));
  const grants = freezePilotValue(structuredClone(input));
  const byScope = new Map<string, CorporateSigningGrant>();
  for (const grant of grants) {
    const config = grant.configuration;
    const key = `${config.workspaceId}:${config.projectId}`;
    if (
      byScope.has(key) ||
      pilotContentHash(config.signingPolicyRef) !== pilotContentHash(policyRef) ||
      !grant.serviceIdentity.issuer ||
      !grant.serviceIdentity.subject ||
      !grant.serviceIdentity.serviceKey ||
      !/^[a-z][a-z0-9_.-]{0,127}$/u.test(grant.permission)
    )
      throw new Error("CORPORATE_SIGNING_AUTHORITY_CONFIGURATION_INVALID");
    byScope.set(key, grant);
  }
  const identities = new TypeOrmIdentityRepository(source);
  const access = new TypeOrmCorporateScopedAccessRepository(source);
  const policies = new RuntimeConfigurationRepository();
  const evaluator = new DenyByDefaultAuthorizationPolicy();
  return async (
    manifest: QaEvidenceManifestRevisionV2,
    configuration: CorporateSigningConfiguration,
    signal: AbortSignal,
  ): Promise<boolean> => {
    try {
      const grant = byScope.get(`${configuration.workspaceId}:${configuration.projectId}`);
      if (
        !grant ||
        signal.aborted ||
        pilotContentHash(grant.configuration) !== pilotContentHash(configuration) ||
        manifest.workspaceId !== configuration.workspaceId ||
        manifest.projectId !== configuration.projectId
      )
        return false;
      const identity = await identities.findByVerifiedSubject(
        grant.serviceIdentity.issuer,
        grant.serviceIdentity.subject,
      );
      if (
        !identity ||
        identity.kind !== "SERVICE" ||
        identity.id !== configuration.servicePrincipalId
      )
        return false;
      const scope = {
        kind: "PROJECT" as const,
        workspaceId: configuration.workspaceId,
        projectId: configuration.projectId,
      };
      const workspace = await access.getWorkspace({
        kind: "WORKSPACE",
        workspaceId: scope.workspaceId,
      });
      const project = await access.getProject(scope);
      if (workspace?.state !== "ACTIVE" || project?.state !== "ACTIVE" || signal.aborted)
        return false;
      await source.transaction("REPEATABLE READ", async (manager) =>
        policies.current(manager, scope, policyRef, "SIGNING_POLICY"),
      );
      const at = new Date();
      const decision = evaluator.decide({
        context: {
          scope,
          actor: {
            kind: "SERVICE",
            principalId: identity.id,
            serviceKey: grant.serviceIdentity.serviceKey,
          },
          correlationId: "corporate-evidence-signing",
          causationId: "corporate-evidence-signing",
        },
        permission: grant.permission,
        resourceClassification: defaultClassificationCatalog.reference(
          manifest.effectiveClassificationKey,
        ),
        facts: await access.authorizationFacts(scope, identity.id, at),
        at,
        operationClass: "EFFECT",
        projectOperationalState: "ACTIVE",
      });
      return decision.allowed && !signal.aborted;
    } catch {
      return false;
    }
  };
}
