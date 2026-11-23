export interface ConnectorValidationIssue {
  readonly code: string;
  readonly severity: "ERROR" | "WARNING";
  readonly path: string;
  readonly safeDetail?: string;
}
export interface ConnectorValidationResult {
  readonly status: "VALID" | "INVALID";
  readonly contentHash: string;
  readonly issues: readonly ConnectorValidationIssue[];
  readonly previewHash?: string;
  readonly dryRunHash?: string;
}
export interface ConnectorValidationPort {
  validate(candidate: Readonly<Record<string, unknown>>): Promise<ConnectorValidationResult>;
}
