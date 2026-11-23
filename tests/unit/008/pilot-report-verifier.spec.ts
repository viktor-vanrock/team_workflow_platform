import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import {
  type PilotReportDocument,
  SignedPilotReportVerifier,
} from "../../../packages/runtime-composition/src/pilot/report-verifier.ts";
import { create008SignedReportFixture as fixture } from "../../support/008-signed-report.ts";

describe("authenticated pilot report artifacts", () => {
  it("derives stable execution identity from signed bytes and verifies every evidence digest", async () => {
    const f = fixture();
    const document = f.publish();
    const first = await f.verifier.materialize(f.scope, "engineering", document.reportRef);
    expect(await f.verifier.materialize(f.scope, "engineering", document.reportRef)).toEqual(first);
    expect(first.execution).toMatchObject({
      status: "PASS",
      reportRef: document.reportRef,
      subjectRef: f.policy.subjectRef,
    });
    expect(await f.verifier.verify(first.execution)).toBe(true);
    expect(
      await f.verifier.verify({ ...first.execution, checks: [{ id: "forged", status: "PASS" }] }),
    ).toBe(false);
    vi.mocked(f.store.evidence).mockResolvedValue(Buffer.from("changed evidence"));
    expect(await f.verifier.verify(first.execution)).toBe(false);
  });
  it("rejects content, signature, locator and subject substitution before reading evidence", async () => {
    for (const mutation of ["bytes", "signature", "locator", "subject"] as const) {
      const f = fixture();
      const original = f.publish();
      const changed = structuredClone(original) as PilotReportDocument;
      const candidate =
        mutation === "bytes"
          ? { ...changed, bytes: Buffer.from("forged") }
          : mutation === "signature"
            ? { ...changed, signature: { ...changed.signature, value: "A".repeat(86) } }
            : mutation === "locator"
              ? { ...changed, reportRef: { ...changed.reportRef, id: randomUUID() } }
              : {
                  ...changed,
                  signature: {
                    ...changed.signature,
                    subjectRef: { ...changed.signature.subjectRef, version: 2 },
                  },
                };
      f.documents.set(original.reportRef.id, candidate);
      await expect(
        f.verifier.materialize(f.scope, "engineering", original.reportRef),
      ).rejects.toThrow("PILOT_REPORT_UNVERIFIED");
      expect(f.store.evidence).not.toHaveBeenCalled();
    }
  });
  it("rejects foreign scope, stale fingerprints, duplicate checks and unavailable image proof", async () => {
    const f = fixture();
    for (const body of [
      { ...f.report, scope: { ...f.report.scope, projectIds: [randomUUID()] } },
      { ...f.report, fingerprints: { ...f.report.fingerprints, source: pilotContentHash("old") } },
      { ...f.report, checks: [...f.report.checks, ...f.report.checks] },
    ]) {
      await expect(
        f.verifier.materialize(f.scope, "engineering", f.publish(body).reportRef),
      ).rejects.toThrow("PILOT_REPORT_UNVERIFIED");
    }
    f.policies.current.mockResolvedValue({ ...f.policy, deploymentProfiles: ["integration"] });
    await expect(
      f.verifier.materialize(f.scope, "engineering", f.publish().reportRef),
    ).rejects.toThrow("PILOT_REPORT_UNVERIFIED");
  });
  it("requires authenticated current children; skipped evidence never becomes PASS", async () => {
    const f = fixture();
    const skipped = {
      ...f.report,
      status: "SKIPPED_GATED",
      checks: [
        {
          ...f.report.checks[0],
          status: "SKIPPED_GATED",
          evidence: [],
          reasonCodes: ["MISSING_INPUT"],
        },
      ],
      reasonCodes: ["MISSING_INPUT"],
    };
    const child = f.publish(skipped);
    expect(
      (await f.verifier.materialize(f.scope, "engineering", child.reportRef)).execution.status,
    ).toBe("SKIPPED_GATED");
    const parent = f.publish({
      ...f.report,
      prerequisites: [
        {
          path: "reports/008-pilot-hardening-and-conformance/runs/child.json",
          sha256: child.reportRef.contentHash,
        },
      ],
    });
    await expect(f.verifier.materialize(f.scope, "engineering", parent.reportRef)).rejects.toThrow(
      "PILOT_REPORT_UNVERIFIED",
    );
    const unsafe = f.publish({
      ...f.report,
      checks: [
        {
          ...f.report.checks[0],
          evidence: [
            { ...f.artifact, path: "reports/008-pilot-hardening-and-conformance/../secret" },
          ],
        },
      ],
    });
    vi.mocked(f.store.evidence).mockClear();
    await expect(f.verifier.materialize(f.scope, "engineering", unsafe.reportRef)).rejects.toThrow(
      "PILOT_REPORT_UNVERIFIED",
    );
    expect(f.store.evidence).not.toHaveBeenCalled();
  });
  it("rechecks expiry and key/policy revocation at import and every gate consumption", async () => {
    const f = fixture();
    const document = f.publish();
    const value = await f.verifier.materialize(f.scope, "engineering", document.reportRef);
    f.setNow(Date.parse(value.execution.validUntil));
    expect(await f.verifier.verify(value.execution)).toBe(false);
    const g = fixture();
    const current = g.publish();
    g.policies.current.mockResolvedValueOnce(g.policy).mockResolvedValue({ ...g.policy, keys: [] });
    await expect(g.verifier.materialize(g.scope, "engineering", current.reportRef)).rejects.toThrow(
      "PILOT_REPORT_UNVERIFIED",
    );
  });
  it("bounds unavailable stores and does not expose raw transport diagnostics", async () => {
    const f = fixture();
    const document = f.publish();
    vi.mocked(f.store.report).mockRejectedValue(new Error("SECRET_STORE_CANARY"));
    await expect(
      f.verifier.materialize(f.scope, "engineering", document.reportRef),
    ).rejects.toThrow(/^PILOT_REPORT_UNVERIFIED$/u);
    vi.mocked(f.store.report).mockImplementation(
      async () =>
        new Promise(() => {
          /* Promise intentionally remains pending. */
        }),
    );
    const bounded = new SignedPilotReportVerifier(
      f.store,
      f.policies,
      () => Date.parse("2026-09-04T09:00:00.000Z"),
      10,
    );
    await expect(bounded.materialize(f.scope, "engineering", document.reportRef)).rejects.toThrow(
      "PILOT_REPORT_UNVERIFIED",
    );
  });
  it("holds immutable input snapshots and rejects reports expiring during evidence verification", async () => {
    const f = fixture();
    const original = f.publish();
    const expected = structuredClone(original.reportRef);
    vi.mocked(f.store.report).mockResolvedValue(original);
    vi.mocked(f.store.evidence).mockImplementation(async () => {
      (original.reportRef as { id: string }).id = randomUUID();
      return Buffer.from("independently counted effects: one");
    });
    expect(
      (await f.verifier.materialize(f.scope, "engineering", expected)).execution.reportRef,
    ).toEqual(expected);
    const g = fixture();
    const document = g.publish();
    vi.mocked(g.store.evidence).mockImplementation(async () => {
      g.setNow(Date.parse(g.report.finishedAt) + g.policy.maximumAgeMs);
      return Buffer.from("independently counted effects: one");
    });
    await expect(
      g.verifier.materialize(g.scope, "engineering", document.reportRef),
    ).rejects.toThrow("PILOT_REPORT_UNVERIFIED");
    const h = fixture();
    const child = h.publish({
      ...h.report,
      runId: "earlier-child",
      finishedAt: h.report.startedAt,
    });
    const parent = h.publish({
      ...h.report,
      prerequisites: [
        {
          path: "reports/008-pilot-hardening-and-conformance/runs/earlier-child.json",
          sha256: child.reportRef.contentHash,
        },
      ],
    });
    h.policies.current.mockResolvedValueOnce(h.policy).mockImplementationOnce(async () => {
      h.setNow(Date.parse(h.report.finishedAt) + 1600);
      return h.policy;
    });
    await expect(h.verifier.materialize(h.scope, "engineering", parent.reportRef)).rejects.toThrow(
      "PILOT_REPORT_UNVERIFIED",
    );
  });
});
