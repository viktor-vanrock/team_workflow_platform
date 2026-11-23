import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0001PlatformPrimitives1700000000001 implements MigrationInterface {
  readonly name = "M0001PlatformPrimitives1700000000001";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_schema_versions (
        namespace text PRIMARY KEY,
        version integer NOT NULL CHECK (version >= 0),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE classification_catalog (
        key text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]*$'),
        rank integer NOT NULL UNIQUE CHECK (rank >= 0),
        retired_at timestamptz NULL
      );
      INSERT INTO classification_catalog(key, rank) VALUES ('PUBLIC',0),('INTERNAL',10),('RESTRICTED',20),('CONFIDENTIAL',30);
      CREATE FUNCTION awp_prevent_classification_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.key IS DISTINCT FROM NEW.key OR OLD.rank IS DISTINCT FROM NEW.rank THEN
          RAISE EXCEPTION 'classification key and rank are immutable';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER classification_identity_immutable BEFORE UPDATE ON classification_catalog
        FOR EACH ROW EXECUTE FUNCTION awp_prevent_classification_identity_change();
      INSERT INTO platform_schema_versions(namespace, version) VALUES ('core', 1);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE classification_catalog; DROP FUNCTION awp_prevent_classification_identity_change(); DROP TABLE platform_schema_versions;",
    );
  }
}
