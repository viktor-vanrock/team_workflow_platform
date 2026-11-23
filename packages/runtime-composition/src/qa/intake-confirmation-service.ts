import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

import { QaIntakeDraftService } from "./intake-draft-service.ts";

export interface QaIntakeConfirmationCommandPort {
  confirm(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      draftId: string;
      revision: number;
      contentHash: string;
      principalId: string;
      requestKey: string;
      summary: JsonValue;
      summaryHash: string;
      configurationPins: JsonValue;
      requestHash: string;
    }>,
  ): Promise<unknown>;
}
export class QaIntakeConfirmationService {
  constructor(
    private readonly source: DataSource,
    private readonly commands: QaIntakeConfirmationCommandPort,
  ) {}
  async confirm(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      draftId: string;
      revision: number;
      contentHash: string;
      principalId: string;
      actorKind: "HUMAN" | "SERVICE";
      requestKey: string;
      summary: JsonValue;
      configurationPins: JsonValue;
    }>,
  ) {
    if (input.actorKind !== "HUMAN") throw new Error("QA_CONFIRMATION_HUMAN_REQUIRED");
    const draft = await new QaIntakeDraftService(this.source).get(input, input.draftId);
    if (draft.revision !== input.revision || draft.contentHash !== input.contentHash)
      throw new Error("QA_CONFIRMATION_STALE_REVISION");
    const summaryHash = sha256(input.summary);
    const requestHash = sha256({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      draftId: input.draftId,
      revision: input.revision,
      contentHash: input.contentHash,
      summaryHash,
      configurationPins: input.configurationPins,
      requestKey: input.requestKey,
    });
    return await this.commands.confirm({ ...input, summaryHash, requestHash });
  }
}
