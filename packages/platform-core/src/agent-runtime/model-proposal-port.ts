export interface ModelProposalRequest {
  readonly promptManifestHash: string;
  readonly redactedFacts: readonly unknown[];
  readonly outputSchemaRef: Readonly<{ id: string; version: number; digest: string }>;
  readonly deadline: Date;
}
export interface ModelProposalPort {
  propose(
    request: ModelProposalRequest,
  ): Promise<Readonly<{ output: unknown; modelRef: string; outputHash: string }>>;
}
