export interface ExpiringPresentation {
  readonly intentId: string;
  readonly retainUntil: Date;
  readonly state: string;
}
export interface PresentationPurgePort {
  listExpired(now: Date, limit: number): Promise<readonly ExpiringPresentation[]>;
  purge(intentId: string, now: Date): Promise<void>;
}

export class MattermostPresentationExpirySweeper {
  constructor(private readonly port: PresentationPurgePort) {}
  async run(now: Date, limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error("PRESENTATION_SWEEP_LIMIT_INVALID");
    const expired = await this.port.listExpired(now, limit);
    for (const item of expired) await this.port.purge(item.intentId, now);
    return expired.length;
  }
}
