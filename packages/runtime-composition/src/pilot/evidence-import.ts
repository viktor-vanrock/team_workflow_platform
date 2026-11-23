import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import type { JsonValue } from "@awp/platform-contracts";
import {
  type ActorReference,
  type AuthorizationBasisRef,
  defaultClassificationCatalog,
  type ExactRevisionRef,
  pilotContentHash,
  type PilotRecord,
  type ProjectScope,
  validateAuthorizationBasis,
} from "@awp/platform-core";
import { PilotRepository } from "@awp/platform-persistence-typeorm";

import type { SignedPilotReportVerifier } from "./report-verifier.ts";

export interface PilotEvidenceImportAuthority extends ProjectScope {
  /** Current verified request/workload identity and Core permission; never an actor from report JSON. */
  authorize(
    permission: "pilot.evidence.import",
  ): Promise<
    Readonly<{ actor: ActorReference; basis: AuthorizationBasisRef; classificationCeiling: string }>
  >;
}
const denied = () => new Error("PILOT_EVIDENCE_IMPORT_DENIED");

/** Remote verification precedes the transaction; authority and trust policy are rechecked at commit. */
export class DurablePilotEvidenceImport {
  constructor(
    private readonly source: DataSource,
    private readonly verifier: SignedPilotReportVerifier,
  ) {}
  async import(
    authority: PilotEvidenceImportAuthority,
    input: Readonly<{ executionKey: string; reportRef: ExactRevisionRef }>,
  ) {
    const initial = await this.authorize(authority);
    const scope = { workspaceId: authority.workspaceId, projectId: authority.projectId };
    const verified = await this.verifier.materialize(scope, input.executionKey, input.reportRef);
    const execution = verified.execution;
    const body = {
      id: execution.id,
      version: 1,
      schemaVersion: 1,
      kind: "GATE_EXECUTION",
      ...scope,
      actorRef: verified.executorId,
      correlationId: `pilot-report:${execution.id}`,
      createdAt: execution.evaluatedAt,
      body: {
        execution,
        verificationPolicyRef: verified.verificationPolicyRef,
        verificationPolicyHash: verified.verificationPolicyHash,
      },
    } as const;
    const record: PilotRecord = {
      ...body,
      body: body.body as unknown as Readonly<Record<string, JsonValue>>,
      contentHash: pilotContentHash(body),
    };
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `pilot:${scope.workspaceId}:${scope.projectId}:${record.id}`,
      ]);
      const current = await this.authorize(authority);
      if (
        pilotContentHash(current.actor) !== pilotContentHash(initial.actor) ||
        pilotContentHash(current.basis) !== pilotContentHash(initial.basis)
      )
        throw denied();
      await this.verifier.assertCurrent(verified);
      const prior = (await manager.query(
        "SELECT content_hash FROM pilot_record_revisions WHERE workspace_id=$1 AND project_id=$2 AND record_id=$3 AND version=1",
        [scope.workspaceId, scope.projectId, record.id],
      )) as { content_hash: string }[];
      await new PilotRepository(this.source).publish(record, 0, manager);
      if (!prior.length)
        await manager.query(
          "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,'pilot.evidence.import','SUCCEEDED','VERIFIED_REPORT_IMPORTED',$5,$6,$7,'CONFIDENTIAL',$8)",
          [
            randomUUID(),
            scope.workspaceId,
            scope.projectId,
            current.actor,
            randomUUID(),
            randomUUID(),
            current.basis,
            {
              values: {
                executionId: execution.id,
                executionKey: execution.key,
                status: execution.status,
                executorId: verified.executorId,
              },
              versionRefs: [execution.reportRef, verified.verificationPolicyRef],
            },
          ],
        );
      return {
        execution,
        recordRef: { id: record.id, version: record.version, contentHash: record.contentHash },
        replayed: prior.length > 0,
      };
    });
  }
  private async authorize(authority: PilotEvidenceImportAuthority) {
    const value = await authority.authorize("pilot.evidence.import");
    if (
      !authority.workspaceId ||
      !authority.projectId ||
      !value.actor.principalId ||
      !["HUMAN", "SERVICE"].includes(value.actor.kind) ||
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(value.classificationCeiling),
        defaultClassificationCatalog.reference("CONFIDENTIAL"),
      )
    )
      throw denied();
    validateAuthorizationBasis(
      { kind: "PROJECT", workspaceId: authority.workspaceId, projectId: authority.projectId },
      value.basis,
    );
    if (
      value.actor.kind === "HUMAN"
        ? !value.actor.issuer || !value.actor.subject
        : !value.actor.serviceKey
    )
      throw denied();
    return value;
  }
}
