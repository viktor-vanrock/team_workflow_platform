import { createHash } from "node:crypto";

import { type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { loadEnvironment, localPersonaCatalog } from "@awp/runtime-composition";

import {
  QA_DATA_SOURCE,
  type QaHttpIdentity,
  type QaRequestAuthorizer,
} from "../extensions/qa-api-authorization.ts";
import { authorizeLocalQaApi } from "./local-qa-authorization.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "./local-session.guard.ts";

@Injectable()
export class LocalQaHttpIdentity implements QaHttpIdentity {
  constructor(
    @Inject(LocalSessionGuard) private readonly sessions: LocalSessionGuard,
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
  ) {}
  async interaction(context: ExecutionContext) {
    if (!(await this.sessions.canActivate(context))) throw new Error("QA_IDENTITY_REQUIRED");
    const request = context.switchToHttp().getRequest<LocalSessionRequest>();
    const persona = localPersonaCatalog.resolve(request.localPersonaKey!);
    const rows = (await this.source.query(
      "SELECT id FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'",
      [loadEnvironment().identityIssuer, persona.subject],
    )) as { id: string }[];
    const token = request.headers.authorization;
    if (!rows[0] || typeof token !== "string") throw new Error("QA_IDENTITY_REQUIRED");
    return {
      principalId: rows[0].id,
      authentication: this.sessions.authentication(request),
      binding: `sha256:${createHash("sha256").update(`local:project-selection:${token}`).digest("hex")}`,
    };
  }
  async authenticate(context: ExecutionContext): Promise<QaRequestAuthorizer> {
    if (!(await this.sessions.canActivate(context))) throw new Error("QA_IDENTITY_REQUIRED");
    const request = context.switchToHttp().getRequest<LocalSessionRequest>();
    const verified = {
      headers: request.headers,
      localPersonaKey: request.localPersonaKey,
    } as LocalSessionRequest;
    const authentication = this.sessions.authentication(request);
    return async ({ scope, permission }) => ({
      ...(await authorizeLocalQaApi(
        this.source,
        verified,
        scope.workspaceId,
        scope.projectId,
        permission,
      )),
      ...(authentication ? { authentication } : {}),
    });
  }
}
