import type { DataSource } from "typeorm";

import type { QaHumanActor, QaScope } from "@awp/competency-qa/node";
import { defaultClassificationCatalog, DenyByDefaultAuthorizationPolicy } from "@awp/platform-core";
import {
  TypeOrmIdentityRepository,
  TypeOrmScopedAccessRepository,
} from "@awp/platform-persistence-typeorm";

/** Rechecks the durable HUMAN identity and current Core grants; a worker never impersonates a local persona. */
export function currentQaCommandAuthority(
  source: DataSource,
  scope: QaScope,
  actor: QaHumanActor,
  classificationKey: string,
) {
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    authorize: async (permission: string) => {
      const denied = () => new Error("QA_COMMAND_AUTHORITY_DENIED");
      const identity = await new TypeOrmIdentityRepository(source).findByVerifiedSubject(
        actor.issuer,
        actor.subject,
      );
      if (identity?.kind !== "HUMAN" || identity.id !== actor.principalId) throw denied();
      const projectScope = {
        kind: "PROJECT" as const,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      };
      const access = new TypeOrmScopedAccessRepository(source);
      const workspace = await access.getWorkspace({
        kind: "WORKSPACE",
        workspaceId: scope.workspaceId,
      });
      const project = await access.getProject(projectScope);
      if (workspace?.state !== "ACTIVE" || project?.state !== "ACTIVE") throw denied();
      const at = new Date();
      const facts = await access.authorizationFacts(projectScope, actor.principalId, at);
      const decision = new DenyByDefaultAuthorizationPolicy().decide({
        context: {
          actor,
          scope: projectScope,
          correlationId: "qa-command-current-authority",
          causationId: "qa-command-current-authority",
        },
        permission,
        resourceClassification: defaultClassificationCatalog.reference(classificationKey),
        facts,
        at,
        operationClass: "EFFECT",
        projectOperationalState: "ACTIVE",
      });
      if (!decision.allowed || !decision.basis) throw denied();
      const basis = decision.basis;
      const entitlements = facts.entitlements.filter((grant) =>
        basis.entitlementRefs.some(
          (ref) => ref.id === grant.ref.id && ref.version === grant.ref.version,
        ),
      );
      const ceiling = entitlements
        .map((grant) => defaultClassificationCatalog.reference(grant.classificationCeiling.key))
        .sort((a, b) => b.rank - a.rank)[0];
      const role = facts.roleAssignments.find((assignment) =>
        basis.roleAssignmentRefs.some(
          (ref) => ref.id === assignment.ref.id && ref.version === assignment.ref.version,
        ),
      );
      if (!ceiling || !role) throw denied();
      return {
        actor,
        scope: projectScope,
        basis,
        classificationCeiling: ceiling.key,
        roleKey: role.roleKey,
      };
    },
  };
}
