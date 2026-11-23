import type { DataSource } from "typeorm";

import { loadEnvironment, localPersonaCatalog } from "@awp/runtime-composition";

import { requireQaVerifiedRequest } from "../extensions/qa-api-authorization.ts";
import {
  explicitArtifactScope,
  type QaArtifactScopeResolver,
} from "../extensions/qa-artifact-http-api.ts";
import type { LocalSessionRequest } from "./local-session.guard.ts";

export function createLocalArtifactScope(source: DataSource): QaArtifactScopeResolver {
  return async (value) => {
    if (!["local", "test"].includes(loadEnvironment().profile))
      throw new Error("LOCAL_ARTIFACT_SCOPE_FORBIDDEN");
    requireQaVerifiedRequest(value);
    const request = value as LocalSessionRequest & { params?: Record<string, string> };
    if (
      request.params?.workspaceId ||
      request.params?.projectId ||
      request.headers["x-awp-workspace-id"] ||
      request.headers["x-awp-project-id"]
    )
      return explicitArtifactScope(request);
    const persona = localPersonaCatalog.resolve(request.localPersonaKey!);
    const rows = (await source.query(
      'SELECT w.id AS "workspaceId",p.id AS "projectId" FROM workspaces w JOIN projects p ON p.workspace_id=w.id WHERE w.key=$1 AND p.key=$2',
      [persona.workspaceKey, persona.projectKey],
    )) as { workspaceId: string; projectId: string }[];
    if (!rows[0]) throw new Error("ARTIFACT_NOT_FOUND");
    return rows[0];
  };
}
