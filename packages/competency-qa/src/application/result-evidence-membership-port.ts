import type { QaContentHash, QaScope } from "../domain/primitives.ts";

export interface QaResultEvidenceMembership {
  readonly evidenceLinkId: string;
  readonly contentHash: QaContentHash;
}

export interface QaResultEvidenceMembershipPort {
  resolveFinalized(
    input: Readonly<{
      scope: QaScope;
      workItemId: string;
      sessionId: string;
      planItemId: string;
      evidenceLinkIds: readonly string[];
    }>,
  ): Promise<readonly QaResultEvidenceMembership[]>;
}
