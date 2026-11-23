import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startBindingHttpFixture } from "../../support/007-binding-http-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 durable onboarding HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "registers scoped projects and persists entitlement changes through restart on %s",
      async (image) => {
        const f = await startBindingHttpFixture(image);
        try {
          const catalog = await f.request("");
          expect(catalog).toMatchObject({ status: 200, body: { items: expect.any(Array) } });
          expect((catalog.body.items as { key: string }[]).map((p) => p.key)).toEqual(["ALPHA"]);
          const owners = Object.fromEntries(
            ["business", "technical", "qa", "security", "escalation"].map((k) => [
              k,
              localPersonaIds["owner.local"],
            ]),
          );
          const registration = {
            key: "HTTPPROJECT",
            name: "HTTP registered project",
            ownerIds: owners,
            criticalityKey: "STANDARD",
            dataClassificationKey: "INTERNAL",
            reason: "Local onboarding proof",
          };
          expect(
            (await f.request("", "POST", registration, "admin", "forbidden-registration")).status,
          ).toBe(403);
          expect(
            (
              await f.request(
                "",
                "POST",
                { ...registration, actorId: randomUUID() },
                "owner",
                "forged-registration",
              )
            ).status,
          ).toBe(401);
          const created = await f.request(
            "",
            "POST",
            registration,
            "owner",
            "register-project-http",
          );
          expect(created, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { projectId: expect.any(String), version: 1, stage: "DRAFT" },
          });
          const projectId = created.body.projectId as string;
          const firstPage = await f.request("?limit=1");
          expect(firstPage.body.items).toHaveLength(1);
          const secondPage = await f.request(
            `?limit=1&cursor=${encodeURIComponent(String(firstPage.body.nextCursor))}`,
          );
          expect(secondPage.body.items).toMatchObject([{ id: projectId }]);
          const read = await f.request(`/${projectId}/onboarding`);
          expect(read).toMatchObject({
            status: 200,
            etag: '"1"',
            body: { stage: "DRAFT", project: { id: projectId, key: "HTTPPROJECT" }, gates: [] },
          });
          expect(
            (await f.request(`/${projectId}/onboarding`, "GET", undefined, "admin")).status,
          ).toBe(403);
          await f.restart();
          expect(
            await f.request("", "POST", registration, "owner", "register-project-http"),
          ).toEqual(created);
          expect(
            (
              await f.request(
                "",
                "POST",
                { ...registration, name: "Changed" },
                "owner",
                "register-project-http",
              )
            ).status,
          ).toBe(409);
          expect(
            await f.source.query("SELECT count(*)::int AS n FROM projects WHERE key='HTTPPROJECT'"),
          ).toEqual([{ n: 1 }]);
          const grant = {
            principalId: localPersonaIds["executor.alpha"],
            operation: "GRANT",
            effect: "ALLOW",
            permissions: ["project.onboarding.read"],
            classificationCeilingKey: "INTERNAL",
            validFrom: new Date(Date.now() - 1000).toISOString(),
            reason: "Grant target principal",
          };
          const path = `/${f.scope.projectId}/entitlements`;
          const granted = await f.request(path, "POST", grant, "owner", "grant-target-http");
          expect(granted, f.errors.join("; ")).toMatchObject({
            status: 201,
            body: { entitlementId: expect.any(String), version: 1 },
          });
          const entitlementId = granted.body.entitlementId as string;
          expect(
            (
              await f.request(
                path,
                "POST",
                { ...grant, actor: { principalId: grant.principalId } },
                "owner",
                "forged-entitlement",
              )
            ).status,
          ).toBe(401);
          expect((await f.request(path, "POST", grant, "admin", "unauthorized-grant")).status).toBe(
            403,
          );
          expect(
            (
              await f.request(
                path,
                "POST",
                { ...grant, principalId: localPersonaIds["outsider.delta"] },
                "owner",
                "cross-workspace-target",
              )
            ).status,
          ).toBe(403);
          const replacement = {
            ...grant,
            operation: "REPLACE",
            permissions: ["project.catalog.read"],
          };
          expect(
            (
              await f.request(
                `${path}/${entitlementId}/replace`,
                "POST",
                replacement,
                "owner",
                "replace-stale-target",
                2,
              )
            ).status,
          ).toBe(409);
          const replaced = await f.request(
            `${path}/${entitlementId}/replace`,
            "POST",
            replacement,
            "owner",
            "replace-target-http",
            1,
          );
          expect(replaced).toMatchObject({ status: 201, body: { version: 2 } });
          await f.restart();
          expect(
            await f.request(
              `${path}/${entitlementId}/replace`,
              "POST",
              replacement,
              "owner",
              "replace-target-http",
              1,
            ),
          ).toEqual(replaced);
          const revoked = await f.request(
            `${path}/${entitlementId}/revoke`,
            "POST",
            { reason: "End local grant" },
            "owner",
            "revoke-target-http",
            2,
          );
          expect(revoked).toMatchObject({ status: 201, body: { version: 3 } });
          expect(
            await f.source.query(
              "SELECT operation,version FROM project_entitlement_revisions WHERE entitlement_id=$1 ORDER BY version",
              [entitlementId],
            ),
          ).toEqual([
            { operation: "GRANT", version: 1 },
            { operation: "REPLACE", version: 2 },
            { operation: "REVOKE", version: 3 },
          ]);
          expect(
            await f.source.query(
              "SELECT current_version,revoked_at IS NOT NULL AS revoked FROM project_entitlements WHERE id=$1",
              [entitlementId],
            ),
          ).toEqual([{ current_version: 3, revoked: true }]);
        } finally {
          await f.close();
        }
      },
      180_000,
    );
  },
);
