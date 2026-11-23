import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { pilotContentHash, type ProjectScope } from "@awp/platform-core";
import { TypeOrmIntakeInteractionUnitOfWork } from "@awp/platform-persistence-typeorm";
import { QaIntakeDraftService } from "@awp/runtime-composition";

import type { MattermostProjectSelectionPort } from "./mattermost-project-selection.controller.ts";
import {
  authorizeQaApi,
  qaInteractionSession,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

export type ProjectSelectionInventory = () => Promise<readonly ProjectScope[]>;
export function createMattermostProjectSelectionApi(
  source: DataSource,
  inventory: ProjectSelectionInventory,
): MattermostProjectSelectionPort {
  const unitOfWork = new TypeOrmIntakeInteractionUnitOfWork(source);
  const drafts = new QaIntakeDraftService(source);
  async function scopes(): Promise<readonly ProjectScope[]> {
    const values = await inventory();
    const keys = new Set<string>();
    if (values.length > 100) throw new Error("PROJECT_SELECTION_INVENTORY_INVALID");
    for (const value of values) {
      const key = `${value.workspaceId}:${value.projectId}`;
      if (!value.workspaceId || !value.projectId || keys.has(key))
        throw new Error("PROJECT_SELECTION_INVENTORY_INVALID");
      keys.add(key);
    }
    return values.map(({ workspaceId, projectId }) => Object.freeze({ workspaceId, projectId }));
  }
  async function option(request: object, principalId: string, scope: ProjectScope) {
    const authorization = await authorizeQaApi(
      source,
      request as QaSessionRequest,
      scope.workspaceId,
      scope.projectId,
      "qa.request.create",
    );
    if (authorization.actor.principalId !== principalId)
      throw new ForbiddenException("QA_SCOPE_DENIED");
    const rows = (await source.query(
      "SELECT w.name AS workspace_label,p.name AS project_label,p.row_version FROM workspaces w JOIN projects p ON p.workspace_id=w.id WHERE w.id=$1 AND p.id=$2 AND w.state='ACTIVE' AND p.state='ACTIVE'",
      [scope.workspaceId, scope.projectId],
    )) as { workspace_label: string; project_label: string; row_version: number }[];
    if (!rows[0]) throw new ForbiddenException("QA_SCOPE_DENIED");
    const current = await authorizeQaApi(
      source,
      request as QaSessionRequest,
      scope.workspaceId,
      scope.projectId,
      "qa.request.create",
    );
    if (
      current.actor.principalId !== principalId ||
      pilotContentHash(current.basis) !== pilotContentHash(authorization.basis)
    )
      throw new ForbiddenException("QA_SCOPE_DENIED");
    return Object.freeze({
      ...scope,
      workspaceLabel: rows[0].workspace_label,
      projectLabel: rows[0].project_label,
      configurationHash: pilotContentHash({
        scope,
        basis: current.basis,
        projectVersion: rows[0].row_version,
      }),
    });
  }
  return {
    issue: async (request) => {
      const session = await qaInteractionSession(request);
      const options = [];
      for (const scope of await scopes()) {
        try {
          options.push(await option(request, session.principalId, scope));
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
        }
      }
      // Session rotation/revocation during enumeration must not issue new intents.
      const current = await qaInteractionSession(request);
      if (current.principalId !== session.principalId || current.binding !== session.binding)
        throw new ForbiddenException("QA_INTERACTION_SESSION_REQUIRED");
      return unitOfWork.issueProjectOptions({
        principalId: session.principalId,
        oidcSessionId: session.binding,
        continuationVersion: 1,
        options,
        expiresAt: new Date(Date.now() + 600_000),
      });
    },
    consume: async (request, body) => {
      const session = await qaInteractionSession(request);
      if (
        !body ||
        typeof body.intentId !== "string" ||
        !body.intentId ||
        typeof body.intentToken !== "string" ||
        body.intentToken.length < 32 ||
        typeof body.requestKey !== "string" ||
        body.requestKey.length < 16
      )
        throw new BadRequestException("PROJECT_SELECTION_REQUEST_INVALID");
      const allowed = await scopes();
      const result = await unitOfWork
        .consumeProjectSelection({
          principalId: session.principalId,
          oidcSessionId: session.binding,
          intentId: body.intentId,
          intentToken: body.intentToken,
          requestKey: body.requestKey,
          reauthorize: async (_manager, selected) => {
            if (
              !allowed.some(
                (scope) =>
                  scope.workspaceId === selected.workspaceId &&
                  scope.projectId === selected.projectId,
              )
            )
              return false;
            const current = await option(request, session.principalId, {
              workspaceId: selected.workspaceId,
              projectId: selected.projectId,
            });
            return current.configurationHash === selected.configurationHash;
          },
          createDraft: async (manager, selected) => {
            const created = await drafts.createInTransaction(manager, {
              workspaceId: selected.workspaceId,
              projectId: selected.projectId,
              principalId: session.principalId,
              requestKey: body.requestKey,
              content: { schemaVersion: 1 },
            });
            return {
              id: created.draft.id,
              resultRef: `draft:${created.draft.id}:revision:1`,
              draft: created.draft,
            };
          },
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.startsWith("PROJECT_SELECTION_"))
            throw new ForbiddenException("PROJECT_SELECTION_DENIED");
          throw error;
        });
      await authorizeQaApi(
        source,
        request as QaSessionRequest,
        result.option.workspaceId,
        result.option.projectId,
        "qa.request.create",
      );
      const draft =
        ("draft" in result ? result.draft : undefined) ??
        (await drafts.get(result.option, result.draftRef.split(":")[1] ?? ""));
      return Object.freeze({ draft, replayed: result.replayed });
    },
  };
}
