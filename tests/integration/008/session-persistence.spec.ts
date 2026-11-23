import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  TypeOrmCorporateSessionStore,
  TypeOrmIdentityRevocations,
} from "../../../packages/platform-persistence-typeorm/src/corporate-session.repository.ts";
import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { AesGcmSessionStateCodec } from "../../../packages/platform-runtime-nest/src/auth/session-state-codec.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 persistent authentication state",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "enforces one-use, atomic rotation, expiry and revocation on %s",
      async (image) => {
        const postgres = await startPostgres(image);
        const source = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: migrationClasses(coreMigrationRegistry),
        });
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          let store = new TypeOrmCorporateSessionStore(source);
          const codec = new AesGcmSessionStateCodec("k1", {
            withKey: async (_key, use) => use(key),
          });
          const key = randomBytes(32);
          const now = Date.now();
          const namespace = "deployment-v1:session";
          const first = "a".repeat(64);
          const next = "b".repeat(64);
          const third = "c".repeat(64);
          const value = await codec.seal(
            { secretVerifier: "never-in-db-plaintext", policy: "p1" },
            `${namespace}:${first}`,
          );
          await store.put(namespace, first, value, now + 60_000, now);
          await expect(store.put(namespace, first, value, now + 90_000, now)).rejects.toThrow(
            "AUTHENTICATION_STATE_CONFLICT",
          );
          store = new TypeOrmCorporateSessionStore(source);
          expect(await store.get(namespace, first, now)).toBe(value);
          expect(await store.get("other:session", first, now)).toBeUndefined();
          expect(
            JSON.stringify(await source.query("SELECT * FROM corporate_session_states")),
          ).not.toContain("never-in-db-plaintext");
          expect(await store.get(namespace, first, now + 60_000)).toBeUndefined();
          const race = await Promise.all([
            store.take(namespace, first, now),
            store.take(namespace, first, now),
          ]);
          expect(race.filter((entry) => entry !== undefined)).toEqual([value]);
          await store.put(namespace, first, value, now + 60_000, now);
          const rotated = await Promise.all([
            store.rotate(namespace, first, next, value, now + 60_000, now),
            store.rotate(namespace, first, third, value, now + 60_000, now),
          ]);
          expect(rotated.sort()).toEqual([false, true]);
          expect(await store.get(namespace, first, now)).toBeUndefined();
          await store.remove(namespace, next);
          await store.remove(namespace, third);
          expect(await store.rotate(namespace, first, next, value, now + 60_000, now)).toBe(false);
          await expect(
            store.put(namespace, first, "plaintext-token", now + 1000, now),
          ).rejects.toThrow("AUTHENTICATION_STATE_INVALID");
          const revocations = new TypeOrmIdentityRevocations(source);
          expect(await revocations.active("issuer", "alice", 100)).toBe(true);
          await revocations.revokeThrough("issuer", "alice", 100);
          expect(await revocations.active("issuer", "alice", 100)).toBe(false);
          expect(await revocations.active("issuer", "alice", 101)).toBe(true);
          expect(await revocations.active("other-issuer", "alice", 100)).toBe(true);
          await revocations.revokeThrough("issuer", "alice", 90);
          expect(await revocations.active("issuer", "alice", 99)).toBe(false);
          await store.put(namespace, first, value, now + 1000, now);
          expect(await store.purgeExpired(now + 1000)).toBe(1);
          expect(await store.get(namespace, first, now)).toBeUndefined();
        } finally {
          if (source.isInitialized) await source.destroy();
          await postgres.stop();
        }
      },
      180_000,
    );
  },
);
