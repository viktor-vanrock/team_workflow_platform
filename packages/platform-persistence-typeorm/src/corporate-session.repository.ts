import type { DataSource } from "typeorm";

function key(namespace: string, id: string): void {
  if (!/^[a-zA-Z0-9_:-]{1,128}$/u.test(namespace) || !/^[a-f0-9]{64}$/u.test(id))
    throw new Error("AUTHENTICATION_STATE_INVALID");
}
function at(now: number): Date {
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime()))
    throw new Error("AUTHENTICATION_STATE_INVALID");
  return new Date(now);
}
function value(ciphertext: string, expiresAt: number, now: number): void {
  if (
    ciphertext.length > 45000 ||
    !/^1\.[a-zA-Z0-9_-]{1,64}\.[a-zA-Z0-9_-]{16}\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]+$/u.test(
      ciphertext,
    ) ||
    expiresAt <= now ||
    expiresAt - now > 3600_000
  )
    throw new Error("AUTHENTICATION_STATE_INVALID");
  at(expiresAt);
  at(now);
}

/** Ephemeral encrypted authentication state. Restores must discard these rows. */
export class TypeOrmCorporateSessionStore {
  constructor(private readonly source: DataSource) {}
  async put(
    namespace: string,
    id: string,
    ciphertext: string,
    expiresAt: number,
    now: number,
  ): Promise<void> {
    key(namespace, id);
    value(ciphertext, expiresAt, now);
    const rows = (await this.source.query(
      `INSERT INTO corporate_session_states(namespace,state_key,ciphertext,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING state_key`,
      [namespace, id, ciphertext, at(expiresAt), at(now)],
    )) as unknown[];
    if (rows.length !== 1) throw new Error("AUTHENTICATION_STATE_CONFLICT");
  }
  async get(namespace: string, id: string, now: number): Promise<string | undefined> {
    key(namespace, id);
    const rows = (await this.source.query(
      "SELECT ciphertext FROM corporate_session_states WHERE namespace=$1 AND state_key=$2 AND expires_at>$3",
      [namespace, id, at(now)],
    )) as { ciphertext: string }[];
    return rows[0]?.ciphertext;
  }
  async take(namespace: string, id: string, now: number): Promise<string | undefined> {
    key(namespace, id);
    const rows = (await this.source.query(
      `WITH consumed AS (DELETE FROM corporate_session_states WHERE namespace=$1 AND state_key=$2 RETURNING ciphertext,expires_at)
      SELECT ciphertext FROM consumed WHERE expires_at>$3`,
      [namespace, id, at(now)],
    )) as { ciphertext: string }[];
    return rows[0]?.ciphertext;
  }
  async remove(namespace: string, id: string): Promise<void> {
    key(namespace, id);
    await this.source.query(
      "DELETE FROM corporate_session_states WHERE namespace=$1 AND state_key=$2",
      [namespace, id],
    );
  }
  async rotate(
    namespace: string,
    previous: string,
    next: string,
    ciphertext: string,
    expiresAt: number,
    now: number,
  ): Promise<boolean> {
    key(namespace, previous);
    key(namespace, next);
    value(ciphertext, expiresAt, now);
    if (previous === next) throw new Error("AUTHENTICATION_STATE_INVALID");
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const rows = (await manager.query(
        "SELECT state_key FROM corporate_session_states WHERE namespace=$1 AND state_key=$2 AND expires_at>$3 FOR UPDATE",
        [namespace, previous, at(now)],
      )) as unknown[];
      if (rows.length !== 1) return false;
      await manager.query(
        "INSERT INTO corporate_session_states(namespace,state_key,ciphertext,expires_at,created_at) VALUES($1,$2,$3,$4,$5)",
        [namespace, next, ciphertext, at(expiresAt), at(now)],
      );
      await manager.query(
        "DELETE FROM corporate_session_states WHERE namespace=$1 AND state_key=$2",
        [namespace, previous],
      );
      return true;
    });
  }
  async purgeExpired(now: number, limit = 1000): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
      throw new Error("AUTHENTICATION_STATE_INVALID");
    const rows = (await this.source.query(
      `WITH selected AS (SELECT namespace,state_key FROM corporate_session_states WHERE expires_at<=$1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED),
      removed AS (DELETE FROM corporate_session_states s USING selected d WHERE s.namespace=d.namespace AND s.state_key=d.state_key RETURNING s.state_key)
      SELECT count(*)::int count FROM removed`,
      [at(now), limit],
    )) as { count: number }[];
    return rows[0]?.count ?? 0;
  }
}

export class TypeOrmIdentityRevocations {
  constructor(private readonly source: DataSource) {}
  async active(issuer: string, subject: string, issuedAt: number): Promise<boolean> {
    this.validate(issuer, subject, issuedAt);
    const rows = (await this.source.query(
      "SELECT 1 FROM corporate_identity_revocations WHERE issuer=$1 AND subject=$2 AND revoked_through>=$3",
      [issuer, subject, issuedAt],
    )) as unknown[];
    return rows.length === 0;
  }
  /** Called by an authenticated administrative/revocation adapter, never browser claims. */
  async revokeThrough(issuer: string, subject: string, issuedAt: number): Promise<void> {
    this.validate(issuer, subject, issuedAt);
    await this.source.query(
      `INSERT INTO corporate_identity_revocations(issuer,subject,revoked_through) VALUES($1,$2,$3)
      ON CONFLICT(issuer,subject) DO UPDATE SET revoked_through=GREATEST(corporate_identity_revocations.revoked_through,excluded.revoked_through),row_version=corporate_identity_revocations.row_version+1`,
      [issuer, subject, issuedAt],
    );
  }
  private validate(issuer: string, subject: string, issuedAt: number): void {
    if (
      !issuer ||
      issuer.length > 2048 ||
      !subject ||
      subject.length > 256 ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0
    )
      throw new Error("IDENTITY_REVOCATION_INVALID");
  }
}
