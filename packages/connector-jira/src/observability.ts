export interface JiraSafeAuditInput {
  readonly action: string;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionHeaderId: string;
  readonly externalEntityId?: string;
}
export function jiraSafeAudit(input: JiraSafeAuditInput) {
  return Object.freeze({ ...input, provider: "operational-authority" });
}
export interface JiraAuditLineageInput {
  readonly actorId: string;
  readonly approvalId: string;
  readonly commandId: string;
  readonly pins: readonly Readonly<{ sequence: number; contentHash: string }>[];
  readonly calls: readonly Readonly<{
    operation: string;
    safePathTemplate: string;
    receiptHash: string;
  }>[];
  readonly confirmation: Readonly<{ observationId: string; authorityFieldsHash: string }>;
}
export function buildJiraAuditLineage(input: JiraAuditLineageInput) {
  const steps = [
    { kind: "ACTOR", ref: input.actorId },
    { kind: "APPROVAL", ref: input.approvalId },
    { kind: "COMMAND", ref: input.commandId },
    ...[...input.pins]
      .sort((a, b) => a.sequence - b.sequence)
      .map((pin) => ({ kind: "CONFIGURATION_PIN", ref: `${pin.sequence}:${pin.contentHash}` })),
    ...input.calls.map((call) => ({
      kind: "PROVIDER_CALL",
      ref: `${call.operation}:${call.safePathTemplate}:${call.receiptHash}`,
    })),
    {
      kind: "AUTHORITATIVE_CONFIRMATION",
      ref: `${input.confirmation.observationId}:${input.confirmation.authorityFieldsHash}`,
    },
  ];
  return Object.freeze({ steps: Object.freeze(steps.map((step) => Object.freeze(step))) });
}
