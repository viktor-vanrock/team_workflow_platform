import type { DataSource } from "typeorm";

import {
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  deriveAgentGrants,
  freezePilotValue,
} from "@awp/platform-core";
import {
  TypeOrmCorporateScopedAccessRepository,
  TypeOrmIdentityRepository,
} from "@awp/platform-persistence-typeorm";

import type { CoreAgentGrantAuthority } from "./core-intake-http-api.ts";

/** Operator-supplied mapping; it grants nothing without current Core permissions. */
export interface CorporateAgentGrantConfiguration {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly servicePrincipalId: string;
  readonly serviceIdentity: Readonly<{ issuer: string; subject: string; serviceKey: string }>;
  readonly actions: readonly Readonly<{
    action: string;
    humanPermission: string;
    servicePermission: string;
  }>[];
}

export function createCorporateAgentGrantAuthority(
  source: DataSource,
  configurations: readonly CorporateAgentGrantConfiguration[],
): CoreAgentGrantAuthority {
  if (!source.isInitialized || !configurations.length || configurations.length > 100)
    throw new Error("CORPORATE_AGENT_CONFIGURATION_INVALID");
  const grants = freezePilotValue(structuredClone(configurations));
  const scoped = new Map<string, CorporateAgentGrantConfiguration>();
  const name = /^[a-z][a-z0-9_.-]{0,127}$/u;
  for (const grant of grants) {
    const key = `${grant.workspaceId}:${grant.projectId}`;
    if (
      scoped.has(key) ||
      !grant.workspaceId ||
      !grant.projectId ||
      !grant.servicePrincipalId ||
      !grant.serviceIdentity.issuer ||
      !grant.serviceIdentity.subject ||
      !grant.serviceIdentity.serviceKey ||
      !grant.actions.length ||
      grant.actions.length > 128 ||
      new Set(grant.actions.map((entry) => entry.action)).size !== grant.actions.length ||
      grant.actions.some(
        (entry) =>
          !name.test(entry.action) ||
          !name.test(entry.humanPermission) ||
          !name.test(entry.servicePermission),
      )
    )
      throw new Error("CORPORATE_AGENT_CONFIGURATION_INVALID");
    scoped.set(key, grant);
  }
  const identities = new TypeOrmIdentityRepository(source);
  const access = new TypeOrmCorporateScopedAccessRepository(source);
  const policy = new DenyByDefaultAuthorizationPolicy();
  return {
    resolve: async ({ authorization, subject, skill }) => {
      const scope = authorization.scope;
      const grant = scoped.get(`${scope.workspaceId}:${scope.projectId}`);
      if (
        !grant ||
        authorization.actor.kind !== "HUMAN" ||
        authorization.classificationCeiling === "PUBLIC" ||
        skill.maxClassification !== "INTERNAL"
      )
        throw new Error("AGENT_GRANTS_DENIED");
      const human = await identities.findByVerifiedSubject(
        authorization.actor.issuer,
        authorization.actor.subject,
      );
      const service = await identities.findByVerifiedSubject(
        grant.serviceIdentity.issuer,
        grant.serviceIdentity.subject,
      );
      if (
        human?.kind !== "HUMAN" ||
        human.id !== authorization.actor.principalId ||
        service?.kind !== "SERVICE" ||
        service.id !== grant.servicePrincipalId
      )
        throw new Error("AGENT_GRANTS_DENIED");
      const workspace = await access.getWorkspace({
        kind: "WORKSPACE",
        workspaceId: scope.workspaceId,
      });
      const project = await access.getProject(scope);
      if (workspace?.state !== "ACTIVE" || project?.state !== "ACTIVE")
        throw new Error("AGENT_GRANTS_DENIED");
      const at = new Date();
      const [humanFacts, serviceFacts] = await Promise.all([
        access.authorizationFacts(scope, human.id, at),
        access.authorizationFacts(scope, service.id, at),
      ]);
      const allowed: string[] = [];
      for (const item of skill.actionAllowlist) {
        const mapping = grant.actions.find((entry) => entry.action === item.action);
        if (!mapping) continue;
        const operationClass =
          item.effectClass === "READ_ONLY" ? ("READ" as const) : ("MUTATE" as const);
        const common = {
          scope,
          correlationId: "corporate-agent-grants",
          causationId: "corporate-agent-grants",
        };
        const resourceClassification = defaultClassificationCatalog.reference("INTERNAL");
        const humanDecision = policy.decide({
          context: { ...common, actor: authorization.actor },
          permission: mapping.humanPermission,
          resourceClassification,
          facts: humanFacts,
          at,
          operationClass,
          projectOperationalState: "ACTIVE",
        });
        const serviceDecision = policy.decide({
          context: {
            ...common,
            actor: {
              kind: "SERVICE",
              principalId: service.id,
              serviceKey: grant.serviceIdentity.serviceKey,
            },
          },
          permission: mapping.servicePermission,
          resourceClassification,
          facts: serviceFacts,
          at,
          operationClass,
          projectOperationalState: "ACTIVE",
        });
        if (humanDecision.allowed && serviceDecision.allowed) allowed.push(item.action);
      }
      return {
        servicePrincipalId: service.id,
        grants: deriveAgentGrants({
          subject,
          serviceCeiling: allowed,
          humanAllowedActions: allowed,
          skillAllowlist: skill.actionAllowlist,
          classificationCeiling: "INTERNAL",
        }),
      };
    },
  };
}
