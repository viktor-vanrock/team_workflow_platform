import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0170CorporateSessions1700000000170 implements MigrationInterface {
  readonly name = "M0170CorporateSessions1700000000170";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE corporate_session_states(
        namespace text NOT NULL CHECK(namespace ~ '^[A-Za-z0-9_:-]{1,128}$'),
        state_key text NOT NULL CHECK(state_key ~ '^[a-f0-9]{64}$'),
        ciphertext text NOT NULL CHECK(octet_length(ciphertext) BETWEEN 50 AND 45000),
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
        PRIMARY KEY(namespace,state_key), CHECK(expires_at>created_at)
      );
      CREATE INDEX corporate_session_expiry_idx ON corporate_session_states(expires_at);
      CREATE TABLE corporate_identity_revocations(
        issuer text NOT NULL, subject text NOT NULL,
        revoked_through bigint NOT NULL CHECK(revoked_through>=0),
        row_version bigint NOT NULL DEFAULT 1, PRIMARY KEY(issuer,subject)
      );
      UPDATE platform_schema_versions SET version=170,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE corporate_session_states; DROP TABLE corporate_identity_revocations; UPDATE platform_schema_versions SET version=165,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}
