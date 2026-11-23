import { randomUUID } from "node:crypto";

import { NotFoundException } from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  ArtifactAccessDeniedError,
  type ArtifactAuthorizationContributionRegistry,
  type ArtifactAuthorizationOperation,
  type ArtifactMetadata,
  ArtifactNotFoundError,
  ArtifactService,
  type ClassificationReference,
  defaultClassificationCatalog,
  type ObjectStoragePort,
  type ProjectScope,
  type ScopedArtifactRepository,
  type WorkspaceContext,
} from "@awp/platform-core";

import {
  authorizeQaApi,
  type QaSessionRequest,
  requireQaVerifiedRequest,
} from "./qa-api-authorization.ts";
import type { QaArtifactHttpApi } from "./qa-artifacts.controller.ts";

export type QaArtifactScopeResolver = (request: object) => Promise<ProjectScope>;

/** Client scope values are selectors; every selected scope still requires current Core authority. */
export async function explicitArtifactScope(value: object): Promise<ProjectScope> {
  const request = value as QaSessionRequest & {
    params?: Readonly<Record<string, string | undefined>>;
  };
  const workspaceId = request.params?.workspaceId ?? request.headers["x-awp-workspace-id"];
  const projectId = request.params?.projectId ?? request.headers["x-awp-project-id"];
  if (
    typeof workspaceId !== "string" ||
    typeof projectId !== "string" ||
    !workspaceId ||
    !projectId
  )
    throw new NotFoundException("ARTIFACT_NOT_FOUND");
  return Object.freeze({ workspaceId, projectId });
}

export function createQaArtifactHttpApi(
  input: Readonly<{
    source: DataSource;
    repository: ScopedArtifactRepository;
    storage: ObjectStoragePort;
    scope: QaArtifactScopeResolver;
    contributions: ArtifactAuthorizationContributionRegistry;
  }>,
): QaArtifactHttpApi {
  async function open(request: object) {
    requireQaVerifiedRequest(request);
    const scope = await input.scope(request);
    const initial = await authorizeQaApi(
      input.source,
      request as QaSessionRequest,
      scope.workspaceId,
      scope.projectId,
      "artifact.read",
    );
    const context: WorkspaceContext = Object.freeze({
      actor: initial.actor,
      scope: initial.scope,
      authorizationBasis: initial.basis,
      correlationId: randomUUID(),
      causationId: randomUUID(),
    });
    const recheck = async (classification?: ClassificationReference) => {
      const current = await authorizeQaApi(
        input.source,
        request as QaSessionRequest,
        scope.workspaceId,
        scope.projectId,
        "artifact.read",
      );
      if (current.actor.principalId !== initial.actor.principalId)
        throw new ArtifactAccessDeniedError("INVALID_SCOPE");
      if (
        classification &&
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(current.classificationCeiling),
          classification,
        )
      )
        throw new ArtifactAccessDeniedError("CLASSIFICATION_EXCEEDED");
      return { allowed: true, reason: "ALLOW", basis: current.basis } as const;
    };
    const service = new ArtifactService(input.repository, input.storage, {
      authorizeScope: async () => recheck(),
      authorizeResource: async (_context, _permission, classification) => recheck(classification),
    });
    const contributed = async (
      artifact: ArtifactMetadata,
      operation: ArtifactAuthorizationOperation,
    ) => {
      const decision = await input.contributions.authorize({
        context,
        permission: "artifact.read",
        operation,
        artifact,
      });
      if (!decision.allowed) throw new ArtifactAccessDeniedError(decision.reason);
    };
    return { context, service, recheck, contributed };
  }
  const safe = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (
        error instanceof ArtifactAccessDeniedError ||
        error instanceof ArtifactNotFoundError ||
        (error instanceof Error &&
          ["QA_IDENTITY_REQUIRED", "QA_SCOPE_DENIED"].includes(error.message))
      )
        throw new NotFoundException("ARTIFACT_NOT_FOUND");
      throw error;
    }
  };
  return {
    metadata: (request, artifactId) =>
      safe(async () => {
        const bound = await open(request);
        const artifact = await bound.service.getArtifactMetadata(bound.context, artifactId);
        await bound.contributed(artifact, "READ_METADATA");
        await bound.recheck(artifact.classification);
        return artifact;
      }),
    content: (request, artifactId) =>
      safe(async () => {
        const bound = await open(request);
        const artifact = await bound.service.getArtifactMetadata(bound.context, artifactId);
        await bound.contributed(artifact, "STREAM_CONTENT");
        const content = await bound.service.streamArtifactContent(bound.context, artifactId);
        // The response may start after async controller work; recheck before releasing each chunk.
        async function* body() {
          await safe(async () => {
            await bound.recheck(artifact.classification);
            await bound.contributed(artifact, "STREAM_CONTENT");
          });
          for await (const chunk of content.body) {
            await safe(async () => {
              await bound.recheck(artifact.classification);
              await bound.contributed(artifact, "STREAM_CONTENT");
            });
            yield chunk;
          }
        }
        return Object.freeze({ ...content, body: body() });
      }),
  };
}
