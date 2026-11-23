export interface RetainedArtifact {
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly checksum: `sha256:${string}`;
  readonly state: "AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE";
  readonly version?: number;
  readonly legalHold?: boolean;
}

export class InMemoryArtifactRetentionLedger {
  readonly #history = new Map<string, readonly RetainedArtifact[]>();
  register(input: RetainedArtifact): void {
    if (this.#history.has(input.artifactId)) throw new Error("ARTIFACT_ALREADY_REGISTERED");
    this.#history.set(input.artifactId, [
      Object.freeze({ ...input, version: 1, legalHold: false }),
    ]);
  }
  current(artifactId: string): RetainedArtifact | undefined {
    return structuredClone(this.#history.get(artifactId)?.at(-1));
  }
  observe(artifactId: string, state: RetainedArtifact["state"]): RetainedArtifact {
    const current = this.current(artifactId);
    if (!current) throw new Error("ARTIFACT_NOT_FOUND");
    if (current.legalHold && state === "EXPIRED") throw new Error("ARTIFACT_LEGAL_HOLD_ACTIVE");
    const next = Object.freeze({ ...current, state, version: (current.version ?? 0) + 1 });
    this.#history.set(artifactId, [...this.#history.get(artifactId)!, next]);
    return next;
  }
  hold(artifactId: string): RetainedArtifact {
    const current = this.current(artifactId);
    if (!current) throw new Error("ARTIFACT_NOT_FOUND");
    const next = Object.freeze({
      ...current,
      legalHold: true,
      version: (current.version ?? 0) + 1,
    });
    this.#history.set(artifactId, [...this.#history.get(artifactId)!, next]);
    return next;
  }
}

export class ArtifactRetentionWorker {
  constructor(
    private readonly due: () => Promise<
      readonly Readonly<{ artifactId: string; legalHold: boolean }>[]
    >,
    private readonly expire: (artifactId: string) => Promise<void>,
  ) {}
  async run(): Promise<Readonly<{ inspected: number; expired: number }>> {
    const candidates = await this.due();
    let expired = 0;
    for (const candidate of candidates) {
      if (candidate.legalHold) continue;
      await this.expire(candidate.artifactId);
      expired += 1;
    }
    return Object.freeze({ inspected: candidates.length, expired });
  }
}
