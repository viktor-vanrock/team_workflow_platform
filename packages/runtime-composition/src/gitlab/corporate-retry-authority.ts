import type { DataSource } from "typeorm";

import {
  type QaAutomatedTargetSnapshot,
  type QaAutomationAttemptRecord,
  TypeOrmAutomationExecutionRepository,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  defaultClassificationCatalog,
  DenyByDefaultAuthorizationPolicy,
  pilotContentHash,
} from "@awp/platform-core";
import {
  TypeOrmCommandRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type {
  CorporateConnectorFactories,
  CorporateConnectorRequestAuthority,
} from "../pilot/connector-factories.ts";
import type { PilotCommandEffectGuard } from "../pilot/effect-guard.ts";
import { createCorporateGitLabRetryPolicyAuthority } from "./corporate-retry-policy-authority.ts";
import { createCorporateGitLabRetryQuarantine } from "./corporate-retry-quarantine.ts";
import { createCorporateGitLabRetrySourceProvider } from "./corporate-retry-source-provider.ts";
import { verifyCorporateGitLabRetryTarget } from "./corporate-retry-target.ts";

/** Resolve the retry decision only from stored attempt, current rights and published configuration. */
export function createCorporateGitLabRetryAuthority(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
    connectorAuthority: CorporateConnectorRequestAuthority;
    guard: PilotCommandEffectGuard;
  }>,
) {
  const policy = createCorporateGitLabRetryPolicyAuthority(input);
  const quarantine = createCorporateGitLabRetryQuarantine(input.source, input.environment);
  const attempts = new TypeOrmAutomationExecutionRepository(input.source);
  const commands = new TypeOrmCommandRepository(input.source);
  const access = new TypeOrmScopedAccessRepository(input.source);
  return {
    async resolve(
      attempt: QaAutomationAttemptRecord,
      snapshot: QaAutomatedTargetSnapshot,
      infrastructureCode: string | undefined,
      signal: AbortSignal,
    ) {
      const scope = { workspaceId: attempt.workspaceId, projectId: attempt.projectId };
      const command = await commands.get(
        scope.workspaceId,
        scope.projectId,
        attempt.connectorCommandId,
      );
      const { snapshotHash, ...snapshotBody } = snapshot;
      if (
        !command ||
        command.initialAuthorizationBasisHash !== attempt.authorizationBasisHash ||
        sha256(command.initialAuthorizationBasis as unknown as JsonValue) !==
          attempt.authorizationBasisHash ||
        snapshotHash !== attempt.targetSnapshotHash ||
        sha256(snapshotBody as unknown as JsonValue) !== snapshotHash
      )
        throw new Error("CORPORATE_GITLAB_RETRY_COMMAND_INVALID");
      const revalidateAttempt = async () => {
        const current = await attempts.automationAttempt(scope, attempt.automationAttemptId);
        if (signal.aborted || !current || pilotContentHash(current) !== pilotContentHash(attempt))
          throw new Error("CORPORATE_GITLAB_RETRY_ATTEMPT_STALE");
        await input.guard.assertCommandAllowed(command);
      };
      await revalidateAttempt();
      const resolved = await policy.resolve(attempt, signal);
      const identities = (await input.source.query(
        "SELECT issuer,subject FROM identities WHERE id=$1 AND kind='HUMAN'",
        [attempt.initiatingHumanId],
      )) as readonly { issuer: string; subject: string }[];
      const identity = identities[0];
      if (identities.length !== 1 || !identity || !identity.issuer || !identity.subject)
        throw new Error("CORPORATE_GITLAB_RETRY_HUMAN_REQUIRED");
      const projectScope = { kind: "PROJECT" as const, ...scope };
      const authorizeHuman = async () => {
        const project = await access.getProject(projectScope);
        const checkedAt = new Date();
        if (!project || project.state !== "ACTIVE")
          throw new Error("CORPORATE_GITLAB_RETRY_ACCESS_DENIED");
        const commandClassification = defaultClassificationCatalog.reference(
          command.dataClassificationKey,
        );
        const decision = new DenyByDefaultAuthorizationPolicy().decide({
          context: {
            scope: projectScope,
            actor: {
              kind: "HUMAN",
              principalId: attempt.initiatingHumanId,
              issuer: identity.issuer,
              subject: identity.subject,
            },
            correlationId: attempt.correlationId,
            causationId: attempt.causationId,
          },
          permission: "qa.automation.session.plan",
          resourceClassification:
            project.classification.rank > commandClassification.rank
              ? project.classification
              : commandClassification,
          facts: await access.authorizationFacts(
            projectScope,
            attempt.initiatingHumanId,
            checkedAt,
          ),
          at: checkedAt,
          policyVersion: "corporate-gitlab-retry@1",
          operationClass: "EFFECT",
          projectOperationalState: "ACTIVE",
        });
        if (!decision.allowed || !decision.basis || signal.aborted)
          throw new Error("CORPORATE_GITLAB_RETRY_ACCESS_DENIED");
        return decision.basis;
      };
      const basis = await authorizeHuman();
      const needsTargetRead =
        infrastructureCode !== undefined &&
        resolved.policy.allowedInfrastructureCodes.includes(infrastructureCode);
      let observationHash: `sha256:${string}` | undefined;
      if (needsTargetRead) {
        const provider = await createCorporateGitLabRetrySourceProvider({
          ...input,
          authority: input.connectorAuthority,
          attempt,
          snapshot,
          numericProjectId: resolved.numericProjectId,
          server: resolved.server,
          signal,
          revalidateAttempt: async () => {
            await revalidateAttempt();
            const latest = await policy.resolve(attempt, signal);
            if (latest.metadataHash !== resolved.metadataHash)
              throw new Error("CORPORATE_GITLAB_RETRY_CONFIGURATION_STALE");
          },
        });
        observationHash = await verifyCorporateGitLabRetryTarget({
          snapshot,
          context: provider.context,
          source: provider.source,
          numericProjectId: resolved.numericProjectId,
          revalidate: provider.revalidate,
        });
        await provider.revalidate();
      }
      const quarantineActive = await quarantine.active(attempt, infrastructureCode, signal);
      await revalidateAttempt();
      if (
        sha256((await authorizeHuman()) as unknown as JsonValue) !==
        sha256(basis as unknown as JsonValue)
      )
        throw new Error("CORPORATE_GITLAB_RETRY_ACCESS_DENIED");
      const grants = input.grants.filter(
        (grant) =>
          grant.binding.provider === "GITLAB" &&
          grant.binding.workspaceId === attempt.workspaceId &&
          grant.binding.projectId === attempt.projectId &&
          grant.binding.servicePrincipalId === attempt.executingServiceId &&
          attempt.configurationPins.some(
            (pin) =>
              pin.logicalRole === "TEST_EXECUTION" &&
              pin.projectIntegrationBindingRef.id === grant.integrationBindingRef.id &&
              pin.projectIntegrationBindingRef.version === grant.integrationBindingRef.version &&
              pin.projectIntegrationBindingRef.contentHash ===
                grant.integrationBindingRef.contentHash &&
              pin.profileRef.id === grant.binding.profileRef.id &&
              pin.profileRef.version === grant.binding.profileRef.version &&
              pin.profileRef.contentHash === grant.binding.profileRef.contentHash &&
              pin.connectionRef.id === grant.binding.connectionRef.id &&
              pin.connectionRef.version === grant.binding.connectionRef.version &&
              pin.connectionRef.contentHash === grant.binding.connectionRef.contentHash,
          ),
      );
      const serviceGrant = grants[0];
      if (
        grants.length !== 1 ||
        !serviceGrant ||
        !serviceGrant.serviceIdentity.serviceKey ||
        !(await input.connectorAuthority.authorize(serviceGrant.binding, "CONNECTOR_READ", signal))
      )
        throw new Error("CORPORATE_GITLAB_RETRY_ACCESS_DENIED");
      return Object.freeze({
        policy: resolved.policy,
        artifactPolicy: resolved.artifactPolicy,
        authority: Object.freeze({
          authorizationAllowed: true,
          policyAllowed: true,
          quarantineActive,
          configurationPinsCurrent: true,
          targetCurrent: observationHash !== undefined,
          authorizationRecheckHash: sha256({
            attemptId: attempt.automationAttemptId,
            humanId: attempt.initiatingHumanId,
            serviceId: attempt.executingServiceId,
            basis,
            metadataHash: resolved.metadataHash,
            observationHash: observationHash ?? null,
            quarantineActive,
          } as unknown as JsonValue),
        }),
        executingService: {
          kind: "SERVICE" as const,
          principalId: attempt.executingServiceId,
          serviceKey: serviceGrant.serviceIdentity.serviceKey,
        },
        causalAuthorizationBasis: command.initialAuthorizationBasis,
        decidedAt: new Date().toISOString(),
      });
    },
  };
}
