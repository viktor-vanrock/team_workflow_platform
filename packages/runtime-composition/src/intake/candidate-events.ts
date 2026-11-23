import { createHash, randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
export class CandidateEventEmitter {
  constructor(private readonly source: DataSource) {}
  async emit(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      eventType:
        | "intake.candidate.discovered"
        | "intake.candidate.source-observed"
        | "intake.candidate.decision-recorded"
        | "intake.candidate.converted";
      payload: unknown;
    }>,
    manager?: EntityManager,
  ) {
    const target = manager ?? this.source;
    const envelope = { candidateId: input.candidateId, ...(input.payload as object) };
    await target.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp())",
      [
        randomUUID(),
        input.workspaceId,
        input.projectId,
        input.eventType,
        JSON.stringify(envelope),
        hash(envelope),
      ],
    );
  }
}
