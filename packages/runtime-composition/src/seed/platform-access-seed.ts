import type { DataSource } from "typeorm";

import { localPersonaCatalog } from "../security/local-security.ts";

/** Backfill the directory only. Global administration is assigned by the first local login. */
export async function runPlatformAccessLocalSeed(
  source: DataSource,
  issuer: string,
): Promise<void> {
  await source.transaction(async (manager) => {
    await manager.query(
      "DELETE FROM platform_user_profiles p USING identities i WHERE i.id=p.principal_id AND i.issuer=$1 AND i.subject=ANY($2)",
      [issuer, ["limited.alpha", "outsider.delta", "auditor.local", "auditor.alpha"]],
    );
    for (const { key } of localPersonaCatalog.publicOptions()) {
      const persona = localPersonaCatalog.resolve(key);
      await manager.query(
        `INSERT INTO platform_user_profiles(principal_id,display_name,username)
        SELECT id,display_name,subject FROM identities WHERE issuer=$1 AND subject=$2 AND kind='HUMAN'
        ON CONFLICT(principal_id) DO NOTHING`,
        [issuer, persona.subject],
      );
    }
  });
}
