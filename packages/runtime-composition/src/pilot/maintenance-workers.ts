import type { DataSource } from "typeorm";

import { ArtifactRetentionRepository } from "@awp/platform-persistence-typeorm";

/** Executes authorized retention decisions; physical storage deletion is a separate provider policy. */
export function createArtifactRetentionMaintenanceWorker(
  source: DataSource,
  clock: () => string = () => new Date().toISOString(),
) {
  const repository = new ArtifactRetentionRepository(source);
  return Object.freeze({
    async run(): Promise<Readonly<{ inspected: number; expired: number }>> {
      const candidates = await repository.dueExpirations(clock());
      let expired = 0;
      for (const candidate of candidates)
        if (await repository.expireDue(candidate, clock())) expired++;
      return Object.freeze({ inspected: candidates.length, expired });
    },
  });
}
