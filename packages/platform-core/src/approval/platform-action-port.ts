export interface PlatformAction<TCandidate = unknown, TResult = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly candidate: TCandidate;
  readonly candidateHash: string;
  readonly initiatorId: string;
  readonly state: "PENDING_APPROVAL" | "EXECUTING" | "COMPLETED" | "FAILED";
  readonly result?: TResult;
  readonly rowVersion: number;
}

export interface PlatformActionPort<TCandidate = unknown, TResult = unknown> {
  save(action: PlatformAction<TCandidate, TResult>): Promise<void>;
  get(id: string): Promise<PlatformAction<TCandidate, TResult> | undefined>;
  claim(id: string, expectedVersion: number): Promise<PlatformAction<TCandidate, TResult>>;
  complete(
    id: string,
    expectedVersion: number,
    result: TResult,
  ): Promise<PlatformAction<TCandidate, TResult>>;
  fail(id: string, expectedVersion: number): Promise<PlatformAction<TCandidate, TResult>>;
}
