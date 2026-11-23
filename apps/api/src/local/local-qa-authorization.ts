import { ForbiddenException } from "@nestjs/common";
import type { DataSource } from "typeorm";

import type { QaAuthorizationBasis, QaHumanActor } from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";
import { loadEnvironment, localPersonaCatalog } from "@awp/runtime-composition";

import { currentAuthority } from "../extensions/onboarding/durable-http.ts";
import type { LocalSessionRequest } from "./local-session.guard.ts";

export async function authorizeLocalQaApi(
  source: DataSource,
  request: LocalSessionRequest,
  workspaceId: string,
  projectId: string,
  permission: string,
): Promise<
  Readonly<{
    actor: QaHumanActor;
    basis: QaAuthorizationBasis;
    personaKey: string;
    classificationCeiling: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
    scope: Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>;
  }>
> {
  if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
    throw new ForbiddenException("LOCAL_QA_AUTHORIZATION_FORBIDDEN");
  const personaKey = request.localPersonaKey;
  if (!personaKey) throw new ForbiddenException("QA_IDENTITY_REQUIRED");
  const persona = localPersonaCatalog.resolve(personaKey);
  if (persona.kind !== "HUMAN") throw new ForbiddenException("QA_PERMISSION_DENIED");
  try {
    return await source.transaction("REPEATABLE READ", async (manager) => {
      const [identity] = (await manager.query(
        "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
        [loadEnvironment().identityIssuer, persona.subject],
      )) as { id: string }[];
      if (!identity) throw new Error();
      const scope = { kind: "PROJECT" as const, workspaceId, projectId };
      const access = await currentAuthority(manager, scope, identity.id, permission);
      const classificationCeiling = access.classificationCeiling;
      if (
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(classificationCeiling),
          defaultClassificationCatalog.reference(access.classification),
        )
      )
        throw new Error();
      return Object.freeze({
        actor: access.actor,
        basis: access.basis,
        personaKey,
        classificationCeiling,
        scope,
      });
    });
  } catch {
    throw new ForbiddenException("QA_SCOPE_DENIED");
  }
}
