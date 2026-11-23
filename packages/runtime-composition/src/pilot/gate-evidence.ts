import type { EntityManager } from "typeorm";

import {
  bridgePilotGate,
  gateRequirements,
  pilotContentHash,
  type PilotGateExecution,
  type PilotOnboardingGateResult,
  type PilotRecord,
  samePilotRef,
} from "@awp/platform-core";

import type { SignedPilotReportVerifier, VerifiedPilotReport } from "./report-verifier.ts";

export interface PilotGateEvidencePort {
  /** Rechecks current trust, bytes, fingerprints and every execution behind the persisted Core gate. */
  isCurrent(
    manager: EntityManager,
    gate: PilotOnboardingGateResult,
    signal?: AbortSignal,
  ): Promise<boolean>;
}

export class VerifiedPilotGateEvidence implements PilotGateEvidencePort {
  constructor(private readonly verifier: SignedPilotReportVerifier) {}
  async isCurrent(
    manager: EntityManager,
    gate: PilotOnboardingGateResult,
    parentSignal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      signal.throwIfAborted();
      gate = structuredClone(gate);
      const required = gateRequirements[gate.gateKind];
      if (!required || gate.evidenceRefs.length > 16) return false;
      const rows = (await manager.query(
        `SELECT r.semantic_body,r.content_hash FROM pilot_record_headers h JOIN pilot_record_revisions r
        ON (r.workspace_id,r.project_id,r.record_id,r.version,r.content_hash)=(h.workspace_id,h.project_id,h.record_id,h.current_version,h.current_hash)
        WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.kind='GATE_EXECUTION' AND r.semantic_body->'body'->'execution'->'subjectRef'=$3
        AND r.semantic_body->'body'->'execution'->'reportRef' IN (SELECT value FROM jsonb_array_elements($4::jsonb))
        ORDER BY r.created_at DESC,r.record_id LIMIT 65`,
        [gate.workspaceId, gate.projectId, gate.subjectRef, JSON.stringify(gate.evidenceRefs)],
      )) as { semantic_body: Omit<PilotRecord, "contentHash">; content_hash: string }[];
      if (rows.length > 64) return false;
      const candidates = rows.filter((row) => {
        const execution = row.semantic_body.body.execution as unknown as
          PilotGateExecution | undefined;
        return (
          execution &&
          required.includes(execution.key) &&
          gate.evidenceRefs.some((ref) => samePilotRef(ref, execution.reportRef))
        );
      });
      if (candidates.length > 16) return false;
      const executions: PilotGateExecution[] = [];
      const proofs: VerifiedPilotReport[] = [];
      for (const row of candidates) {
        const record = row.semantic_body;
        const execution = record.body.execution as unknown as PilotGateExecution;
        if (
          pilotContentHash(record) !== row.content_hash ||
          record.id !== execution.id ||
          record.kind !== "GATE_EXECUTION" ||
          record.workspaceId !== gate.workspaceId ||
          record.projectId !== gate.projectId ||
          execution.workspaceId !== gate.workspaceId ||
          execution.projectId !== gate.projectId
        )
          continue;
        let proof: VerifiedPilotReport;
        try {
          proof = await this.verifier.materialize(gate, execution.key, execution.reportRef, signal);
        } catch {
          continue;
        }
        if (
          pilotContentHash(proof.execution) !== pilotContentHash(execution) ||
          pilotContentHash(proof.verificationPolicyRef) !==
            pilotContentHash(record.body.verificationPolicyRef) ||
          proof.verificationPolicyHash !== record.body.verificationPolicyHash
        )
          continue;
        executions.push(execution);
        proofs.push(proof);
      }
      if (
        executions.length !== gate.evidenceRefs.length ||
        new Set(executions.map((value) => value.key)).size !== executions.length
      )
        return false;
      // Core hashes evidence in publication order; database row order is not that order.
      executions.sort(
        (a, b) =>
          gate.evidenceRefs.findIndex((ref) => samePilotRef(ref, a.reportRef)) -
          gate.evidenceRefs.findIndex((ref) => samePilotRef(ref, b.reportRef)),
      );
      for (const proof of proofs) await this.verifier.assertCurrent(proof, signal);
      const rebuilt = await bridgePilotGate(
        {
          id: gate.id,
          workspaceId: gate.workspaceId,
          projectId: gate.projectId,
          kind: gate.gateKind,
          subjectRef: gate.subjectRef,
          evaluatedAt: gate.evaluatedAt,
          evaluatorId: gate.evaluatedBy,
          executions,
        },
        { verify: async () => true },
      );
      return rebuilt.contentHash === gate.contentHash;
    } catch {
      return false;
    }
  }
}
