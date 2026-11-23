import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { digest } from "../../../apps/api/src/extensions/onboarding/durable-http.ts";
import { localEvidencePolicies } from "../../../apps/api/src/local/local-evidence-integrity.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { startEvidenceHttpFixture } from "../../support/007-evidence-http-fixture.ts";
import { startScopeProcess } from "../../support/007-scope-child.ts";
import {
  prepareScopePrincipals,
  prepareScopeResources,
  scopePermissions,
} from "../../support/007-scope-fixture.ts";
import { assertScopedReadResponse } from "../../support/007-scope-openapi.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

type Document = Record<string, unknown>;
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 independent multi-principal scope journey",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "filters persisted search, queue, events, artifacts and exports on %s",
      async (image) => {
        const f = await startEvidenceHttpFixture(image);
        let api: Awaited<ReturnType<typeof startScopeProcess>> | undefined;
        try {
          await prepareScopePrincipals(f.source);
          api = await startScopeProcess(f.postgres.url, f.directory);
          expect(api.pid).not.toBe(process.pid);
          const workspaceId = f.scope.workspaceId,
            base = `/api/v1/workspaces/${workspaceId}`,
            legacy = `/v1/workspaces/${workspaceId}/projects`;
          const request = async (
            path: string,
            token = "lead",
            body?: unknown,
            match?: string,
            key: string = randomUUID(),
          ) => {
            const response = await fetch(api!.origin + path, {
              method: body === undefined ? "GET" : "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "idempotency-key": key,
                ...(match ? { "if-match": match } : {}),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const raw = await response.text();
            let payload: Document;
            try {
              payload = JSON.parse(raw) as Document;
            } catch {
              payload = { raw };
            }
            const result = {
              status: response.status,
              body: payload,
              headers: Object.fromEntries(response.headers),
            };
            assertScopedReadResponse(path, result);
            return result;
          };
          const ok = async (...args: Parameters<typeof request>) => {
            const r = await request(...args);
            expect(r.status, JSON.stringify(r.body) + api!.diagnostics()).toBeLessThan(300);
            return r;
          };
          const generationId = randomUUID();
          await f.source.query(
            "INSERT INTO queue_projection_generations(generation_id,workspace_id,state,source_high_watermarks,input_set_hash,started_at,activated_at) VALUES($1,$2,'ACTIVE','{}',$3,now(),now())",
            [generationId, workspaceId, digest("scope-generation")],
          );
          const targets: (Awaited<ReturnType<typeof prepareScopeResources>> & {
            entitlements: Record<string, { id: string; version: number }>;
          })[] = [];
          for (const [index, classification] of (
            ["INTERNAL", "RESTRICTED", "INTERNAL"] as const
          ).entries()) {
            const names = ["Scope A", "Scope B", "Hidden C"];
            const registered = await ok(`${base}/projects`, "owner", {
              key: `SCOPE${index}`,
              name: names[index],
              ownerIds: Object.fromEntries(
                ["business", "technical", "qa", "security", "escalation"].map((k) => [
                  k,
                  localPersonaIds["owner.local"],
                ]),
              ),
              criticalityKey: "STANDARD",
              dataClassificationKey: classification,
              reason: "Controlled scope journey",
            });
            const projectId = String(registered.body.projectId),
              entitlements: Record<string, { id: string; version: number }> = {};
            for (const [token, persona, ceiling] of [
              ["lead", "lead.alpha", "RESTRICTED"],
              ["executor", "executor.alpha", "INTERNAL"],
            ] as const) {
              const head = await ok(`${base}/projects/${projectId}/onboarding`, "owner");
              const grant = await ok(
                `${base}/projects/${projectId}/entitlements`,
                "owner",
                {
                  principalId: localPersonaIds[persona],
                  operation: "GRANT",
                  effect: index === 2 ? "DENY" : "ALLOW",
                  permissions: scopePermissions,
                  classificationCeilingKey: token === "lead" ? classification : ceiling,
                  validFrom: new Date(Date.now() - 1000).toISOString(),
                  reason: "Scoped reader fixture",
                },
                head.headers.etag,
              );
              entitlements[token] = {
                id: String(grant.body.entitlementId),
                version: Number(grant.body.version),
              };
            }
            targets.push({
              ...(await prepareScopeResources(
                f.source,
                f.directory,
                { workspaceId, projectId },
                classification,
                generationId,
              )),
              entitlements,
            });
          }
          const [a, b, c] = targets;
          expect(targets).toHaveLength(3);
          const restricted = await prepareScopeResources(
            f.source,
            f.directory,
            { workspaceId, projectId: a!.projectId },
            "RESTRICTED",
            generationId,
          );
          const ids = (values: unknown, key = "projectId") =>
            (values as Document[]).map((v) => String(v[key])).sort();
          const surfaces = async (token: string, expected: string[]) => {
            expect(ids((await ok(`${base}/projects`, token)).body.items)).toEqual(
              [...expected].sort(),
            );
            expect(ids((await ok(`${base}/project-search?q=Scope`, token)).body.items)).toEqual(
              [...expected].sort(),
            );
            const events = (await ok(`${base}/project-events`, token)).body.items as Document[];
            expect([...new Set(ids(events))].sort()).toEqual([...expected].sort());
            const queue = await ok(`${base}/qa/queue`, token);
            expect(ids((queue.body.items as Document[]).map((v) => v.entry))).toEqual(
              [...expected].sort(),
            );
            expect(queue.body.visibleCounts).toMatchObject({ total: expected.length });
            expect(JSON.stringify({ events, queue: queue.body })).not.toContain(c!.projectId);
            for (const target of targets) {
              const visible = expected.includes(target.projectId),
                status = visible ? 200 : 404;
              expect(
                (await request(`${base}/projects/${target.projectId}/onboarding`, token)).status,
              ).toBe(status);
              const item = await request(
                `${base}/projects/${target.projectId}/work-items/${target.workItemId}`,
                token,
              );
              expect(item.status, JSON.stringify(item.body)).toBe(status);
              const artifact = await request(
                `${base}/projects/${target.projectId}/artifacts/${target.artifactId}`,
                token,
              );
              expect(artifact.status, JSON.stringify(artifact.body)).toBe(status);
              const content = await request(
                `${base}/projects/${target.projectId}/artifacts/${target.artifactId}/content`,
                token,
              );
              expect(content.status, JSON.stringify(content.body)).toBe(status);
              if (visible) {
                expect(content.body.raw).toBe(target.bytes.toString());
                expect(content.headers["x-content-sha256"]).toBe(target.checksum);
                expect(JSON.stringify(artifact.body)).not.toContain("opaqueLocator");
              }
              const evidence = await request(
                `${legacy}/${target.projectId}/evidence/packages/${target.evidencePackage.packageId}`,
                token,
              );
              expect(evidence.status, JSON.stringify(evidence.body)).toBe(status);
              const verification = await request(
                `${legacy}/${target.projectId}/evidence/manifests/${target.manifest.manifestId}/verify?revision=1`,
                token,
                {},
              );
              expect(verification.status, JSON.stringify(verification.body)).toBe(status);
              if (visible)
                expect(verification.body).toMatchObject({ signature: "PASS", integrity: "PASS" });
            }
          };
          await surfaces("lead", [a!.projectId, b!.projectId]);
          await surfaces("executor", [a!.projectId]);
          // A second session of the same principal may have a stricter verified ceiling.
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='RESTRICTED' WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [workspaceId, a!.projectId, localPersonaIds["lead.alpha"]],
          );
          expect(
            (
              await ok(
                `${base}/projects/${a!.projectId}/work-items/${restricted.workItemId}`,
                "lead",
              )
            ).body.id,
          ).toBe(restricted.workItemId);
          await surfaces("limited", [a!.projectId]);
          expect(
            (
              await request(
                `${base}/projects/${a!.projectId}/work-items/${restricted.workItemId}`,
                "limited",
              )
            ).status,
          ).toBe(404);
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='INTERNAL' WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3 AND effect='ALLOW'",
            [workspaceId, a!.projectId, localPersonaIds["lead.alpha"]],
          );
          for (const token of ["lead", "executor"]) {
            for (const path of [
              `${base}/projects/${a!.projectId}/work-items/${restricted.workItemId}`,
              `${base}/projects/${a!.projectId}/artifacts/${restricted.artifactId}`,
              `${base}/projects/${a!.projectId}/artifacts/${restricted.artifactId}/content`,
              `${legacy}/${a!.projectId}/evidence/packages/${restricted.evidencePackage.packageId}`,
            ])
              expect((await request(path, token)).status).toBe(404);
            expect(
              (
                await request(
                  `${base}/projects/${a!.projectId}/qa/queue/items/${restricted.workItemId}`,
                  token,
                )
              ).status,
            ).toBe(404);
          }
          const searchCursor = (await ok(`${base}/project-search?limit=1`)).body.nextCursor;
          const eventCursor = (await ok(`${base}/project-events?limit=1`)).body.nextCursor;
          const queueCursor = (await ok(`${base}/qa/queue?pageSize=1`)).body.nextCursor;
          expect(searchCursor).toEqual(expect.any(String));
          expect(eventCursor).toEqual(expect.any(String));
          expect(queueCursor).toEqual(expect.any(String));
          for (const [path, cursor] of [
            ["project-search", searchCursor],
            ["project-events", eventCursor],
            ["qa/queue", queueCursor],
          ])
            expect(
              (
                await request(
                  `${base}/${path}?cursor=${encodeURIComponent(String(cursor))}`,
                  "executor",
                )
              ).status,
            ).toBe(409);
          // Hidden changes must not alter a visible count, cursor or replay page.
          const cursorPages = await Promise.all(
            [
              ["project-search", searchCursor],
              ["project-events", eventCursor],
              ["qa/queue", queueCursor],
            ].map(([path, cursor]) =>
              ok(`${base}/${path}?cursor=${encodeURIComponent(String(cursor))}`),
            ),
          );
          await f.source.query(
            "UPDATE projects SET name='Invisible renamed project',row_version=row_version+1 WHERE workspace_id=$1 AND id=$2",
            [workspaceId, c!.projectId],
          );
          for (const [index, [path, cursor]] of [
            ["project-search", searchCursor],
            ["project-events", eventCursor],
            ["qa/queue", queueCursor],
          ].entries())
            expect(
              (await ok(`${base}/${path}?cursor=${encodeURIComponent(String(cursor))}`)).body,
            ).toEqual(cursorPages[index]!.body);
          expect(
            (await request(`${base}/projects/${a!.projectId}/artifacts/${b!.artifactId}`)).status,
          ).toBe(404);
          expect(
            (
              await request(
                `${legacy}/${a!.projectId}/evidence/packages/${b!.evidencePackage.packageId}`,
              )
            ).status,
          ).toBe(404);
          expect(
            (
              await request(
                `${legacy}/${b!.projectId}/evidence/packages/${b!.evidencePackage.packageId}/exports`,
                "executor",
                {
                  packageVersion: 1,
                  redactionPolicyRef: localEvidencePolicies.redactionPolicyRef,
                  format: "JSON",
                  reason: "Denied classification",
                },
              )
            ).status,
          ).toBe(404);
          const exported = await ok(
            `${legacy}/${a!.projectId}/evidence/packages/${a!.evidencePackage.packageId}/exports`,
            "lead",
            {
              packageVersion: 1,
              redactionPolicyRef: localEvidencePolicies.redactionPolicyRef,
              format: "JSON",
              reason: "Authorized export",
            },
            undefined,
            "scope-export-once",
          );
          await api.close();
          api = await startScopeProcess(f.postgres.url, f.directory);
          await surfaces("lead", [a!.projectId, b!.projectId]);
          const grant = a!.entitlements.lead!;
          await ok(
            `${legacy}/${a!.projectId}/entitlements/${grant.id}/revoke`,
            "owner",
            { reason: "Access withdrawn during journey" },
            `"${grant.version}"`,
          );
          await surfaces("lead", [b!.projectId]);
          await surfaces("executor", [a!.projectId]);
          for (const [path, cursor] of [
            ["project-search", searchCursor],
            ["project-events", eventCursor],
            ["qa/queue", queueCursor],
          ])
            expect(
              (await request(`${base}/${path}?cursor=${encodeURIComponent(String(cursor))}`))
                .status,
            ).toBe(409);
          expect(
            (await request(`${legacy}/${a!.projectId}/evidence/exports/${exported.body.commandId}`))
              .status,
          ).toBe(404);
          expect(
            (
              await request(
                `${legacy}/${a!.projectId}/evidence/packages/${a!.evidencePackage.packageId}/exports`,
                "lead",
                {
                  packageVersion: 1,
                  redactionPolicyRef: localEvidencePolicies.redactionPolicyRef,
                  format: "JSON",
                  reason: "Authorized export",
                },
                undefined,
                "scope-export-once",
              )
            ).status,
          ).toBe(404);
          await api.close();
          api = await startScopeProcess(f.postgres.url, f.directory);
          await surfaces("lead", [b!.projectId]);
          const missing = randomUUID();
          const safe = (r: Awaited<ReturnType<typeof request>>) => ({
            status: r.status,
            body: Object.fromEntries(
              Object.entries(r.body).filter(([k]) => k !== "correlationId" && k !== "instance"),
            ),
          });
          expect(
            safe(await request(`${base}/projects/${c!.projectId}/work-items/${c!.workItemId}`)),
          ).toEqual(safe(await request(`${base}/projects/${missing}/work-items/${missing}`)));
          expect((await request(`${base}/project-search?q=Hidden`)).body).toMatchObject({
            items: [],
            visibleCount: 0,
          });
          for (const [forbidden, absent, body] of [
            [
              `${base}/projects/${c!.projectId}/onboarding`,
              `${base}/projects/${missing}/onboarding`,
              undefined,
            ],
            [
              `${base}/projects/${c!.projectId}/artifacts/${c!.artifactId}`,
              `${base}/projects/${missing}/artifacts/${missing}`,
              undefined,
            ],
            [
              `${base}/projects/${c!.projectId}/artifacts/${c!.artifactId}/content`,
              `${base}/projects/${missing}/artifacts/${missing}/content`,
              undefined,
            ],
            [
              `${legacy}/${c!.projectId}/evidence/packages/${c!.evidencePackage.packageId}`,
              `${legacy}/${missing}/evidence/packages/${missing}`,
              undefined,
            ],
            [
              `${legacy}/${c!.projectId}/evidence/manifests/${c!.manifest.manifestId}/verify?revision=1`,
              `${legacy}/${missing}/evidence/manifests/${missing}/verify?revision=1`,
              {},
            ],
            [
              `${base}/projects/${c!.projectId}/qa/queue/items/${c!.workItemId}`,
              `${base}/projects/${missing}/qa/queue/items/${missing}`,
              undefined,
            ],
          ] as const)
            expect(safe(await request(forbidden, "lead", body))).toEqual(
              safe(await request(absent, "lead", body)),
            );
          const audits = (await f.source.query(
            "SELECT actor,authorization_basis,attributes FROM audit_events WHERE workspace_id=$1 AND project_id=$2 AND action='qa.evidence.export'",
            [workspaceId, a!.projectId],
          )) as {
            actor: { principalId: string };
            authorization_basis: unknown;
            attributes: unknown;
          }[];
          expect(audits).toHaveLength(1);
          expect(audits[0]).toMatchObject({
            actor: { principalId: localPersonaIds["lead.alpha"] },
            authorization_basis: expect.any(Object),
            attributes: expect.any(Object),
          });
          expect(api.diagnostics()).not.toContain(c!.projectId);
          expect(api.diagnostics()).not.toContain("Invisible renamed project");
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM work_items WHERE workspace_id=$1 AND project_id=ANY($2::uuid[])",
              [workspaceId, targets.map((t) => t.projectId)],
            ),
          ).toEqual([{ n: 4 }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM evidence_export_records WHERE workspace_id=$1 AND project_id=$2",
              [workspaceId, a!.projectId],
            ),
          ).toEqual([{ n: 1 }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM connector_commands WHERE workspace_id=$1 AND project_id=ANY($2::uuid[])",
              [workspaceId, targets.map((t) => t.projectId)],
            ),
          ).toEqual([{ n: 0 }]);
        } finally {
          await api?.close();
          await f.close();
        }
      },
      180_000,
    );
  },
);
