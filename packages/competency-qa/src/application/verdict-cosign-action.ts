import { QaDomainError, type QaExactReference } from "../domain/primitives.ts";
import type { QaVerdictAggregate } from "../domain/verdict.ts";
import type { QaPlatformAction } from "./exact-action-port.ts";
import { cosignQaVerdict } from "./sign-verdict.ts";

export const QA_VERDICT_COSIGN_ACTION_KIND = "qa.verdict.cosign";

export interface QaVerdictCosignSubject {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly verdictRef: QaExactReference;
  readonly primarySignerId: string;
}

export function createQaVerdictCosignActionContribution(
  input: Readonly<{
    verdictById: (id: string) => Promise<QaVerdictAggregate | undefined>;
    roleFor: (approverId: string, workspaceId: string, projectId: string) => Promise<string>;
    permissionFor: (
      approverId: string,
      permission: string,
      workspaceId: string,
      projectId: string,
    ) => Promise<boolean>;
    now: () => string;
  }>,
) {
  return Object.freeze({
    key: "qa.verdict-cosign-action",
    order: 2460,
    matches: (action: QaPlatformAction) => action.kind === QA_VERDICT_COSIGN_ACTION_KIND,
    execute: async (
      action: QaPlatformAction<Readonly<{ subject: QaVerdictCosignSubject; expiresAt?: string }>>,
      context: Readonly<{
        workspaceId: string;
        projectId: string;
        approverId: string;
        authorizationBasisHash: string;
      }>,
    ) => {
      const verdict = await input.verdictById(action.candidate.subject.verdictRef.id);
      if (
        !verdict ||
        verdict.contentHash !== action.candidate.subject.verdictRef.contentHash ||
        verdict.version !== action.candidate.subject.verdictRef.version
      )
        throw new QaDomainError("QA_VERDICT_COSIGN_STALE");
      const signature = cosignQaVerdict(verdict, {
        actor: {
          kind: "HUMAN",
          principalId: context.approverId,
          issuer: "platform",
          subject: context.approverId,
        },
        role: await input.roleFor(context.approverId, context.workspaceId, context.projectId),
        permission: "qa.verdict.cosign",
        liveAuthorized: await input.permissionFor(
          context.approverId,
          "qa.verdict.cosign",
          context.workspaceId,
          context.projectId,
        ),
        authorizationBasisHash: context.authorizationBasisHash as `sha256:${string}`,
        actionRef: {
          id: action.id,
          version: action.rowVersion,
          contentHash: action.candidate.subject.verdictRef.contentHash,
        },
        expiresAt: action.candidate.expiresAt ?? input.now(),
        now: input.now(),
        subjectMatches: action.candidate.subject.primarySignerId !== context.approverId,
      });
      return Object.freeze({ verdictRef: verdict.ref, signature });
    },
  });
}
