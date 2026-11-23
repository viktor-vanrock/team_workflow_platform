import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalize, type JsonValue } from "../../../packages/platform-contracts/src/index.ts";
import { GitLabNativeIngressSource } from "../../../packages/runtime-composition/src/gitlab/corporate-ingress.ts";
import { JiraNativeIngressSource } from "../../../packages/runtime-composition/src/jira/corporate-ingress.ts";
import { selectProviderConformance } from "../../../packages/runtime-composition/src/pilot/provider-conformance.ts";
import {
  IngressHmacKeys,
  ingressRawHash,
  TrustedIngressAdapter,
} from "../../../packages/runtime-composition/src/pilot/trusted-ingress.ts";
import { ingressFixture } from "../../support/008-ingress.ts";

describe("008 authenticated provider ingress", () => {
  it("requires GitLab signed delivery/time/body, rejects token fallback and pins the numeric project", async () => {
    const f = ingressFixture("GITLAB"),
      native = new GitLabNativeIngressSource(f.policy, f.sourceKeys);
    expect(await native.authenticate(f.request(), f.now)).toMatchObject({
      semanticId: "delivery-1",
      bodyHash: ingressRawHash(f.body),
    });
    for (const headers of [
      { "x-gitlab-token": "fixture" },
      { ...f.request().headers, "webhook-id": "forged" },
      {
        ...f.request().headers,
        "webhook-timestamp": String(Math.floor(f.now.getTime() / 1000) + 1),
      },
    ])
      await expect(native.authenticate({ ...f.request(), headers }, f.now)).rejects.toThrow();
    await expect(
      native.authenticate(f.request({ project: { id: 5002 } }), f.now),
    ).rejects.toThrow();
    await expect(
      native.authenticate(f.request(), new Date(f.now.getTime() + 301000)),
    ).rejects.toThrow();
    const key = f.policy.sourceKeys[1]!,
      overlapSecret = new TextEncoder().encode("different-overlap-key-at-least-32-bytes");
    const keys = new IngressHmacKeys(f.policy, f.policy.sourceKeys, {
      use: async (ref, consume) => consume(ref.id === key.ref.id ? overlapSecret : f.sourceSecret),
    });
    const request = f.request(),
      timestamp = request.headers["webhook-timestamp"]!;
    const signature = createHmac("sha256", overlapSecret)
      .update(`delivery-1.${timestamp}.`)
      .update(request.rawBody)
      .digest("base64");
    const rotated = {
      ...request,
      headers: { ...request.headers, "webhook-signature": `v1,${signature}` },
    };
    expect(
      (await new GitLabNativeIngressSource(f.policy, keys).authenticate(rotated, f.now))
        .sourceKeyRef,
    ).toEqual(key.ref);
    await expect(
      new GitLabNativeIngressSource(f.policy, keys).authenticate(
        rotated,
        new Date(f.now.getTime() + 61000),
      ),
    ).rejects.toThrow();
  });
  it("pins exact installed dialect evidence and never promotes a mock into corporate conformance", async () => {
    const f = ingressFixture();
    expect(await selectProviderConformance(f.policy, f.conformance, f.authority, f.now)).toEqual(
      f.conformance,
    );
    for (const policy of [
      { ...f.policy, subject: { ...f.policy.subject, providerVersion: "unknown" } },
      { ...f.policy, subject: { ...f.policy.subject, mode: "CORPORATE" as const } },
      { ...f.policy, conformanceRef: { ...f.policy.conformanceRef, version: 2 } },
    ])
      await expect(
        selectProviderConformance(policy, f.conformance, f.authority, f.now),
      ).rejects.toThrow();
    await expect(
      selectProviderConformance(
        f.policy,
        f.conformance,
        { ...f.authority, verifyEvidence: async () => false },
        f.now,
      ),
    ).rejects.toThrow();
  });
  it("authenticates raw Jira bytes and rejects forged headers, foreign scope and stale signed bodies", async () => {
    const f = ingressFixture();
    const native = new JiraNativeIngressSource(f.policy, f.sourceKeys);
    expect(await native.authenticate(f.request(), f.now)).toMatchObject({
      bodyHash: ingressRawHash(f.body),
      occurredAt: f.now.toISOString(),
    });
    await expect(
      native.authenticate({ ...f.request(), rawBody: new TextEncoder().encode("{}") }, f.now),
    ).rejects.toThrow();
    const stale = f.request({ timestamp: f.now.getTime() - 600_000 });
    await expect(
      native.authenticate(
        { ...stale, headers: { ...stale.headers, "x-awp-timestamp": f.now.toISOString() } },
        f.now,
      ),
    ).rejects.toThrow();
    await expect(
      native.authenticate(
        f.request({ issue: { id: "10001", fields: { project: { id: "other-project" } } } }),
        f.now,
      ),
    ).rejects.toThrow();
    const proof = await native.authenticate(
      {
        ...f.request(),
        headers: { ...f.request().headers, "x-atlassian-webhook-identifier": "forged-delivery" },
      },
      f.now,
    );
    expect(proof.semanticId).toBe((await native.authenticate(f.request(), f.now)).semanticId);
  });
  it("cannot act as an anonymous signing endpoint and checks original freshness downstream", async () => {
    const f = ingressFixture();
    let signs = 0;
    const keys = new IngressHmacKeys(f.policy, f.policy.proxyKeys, {
      use: async (_ref, consume) => {
        signs++;
        return consume(f.proxySecret);
      },
    });
    const gateway = new TrustedIngressAdapter(
      f.policy,
      new JiraNativeIngressSource(f.policy, f.sourceKeys),
      keys,
    );
    await expect(gateway.attest({ ...f.request(), headers: {} }, f.now)).rejects.toThrow();
    expect(signs).toBe(0);
    const envelope = await gateway.attest(f.request(), f.now);
    expect(signs).toBe(1);
    expect(await gateway.verify(f.request(), envelope, f.now)).toMatchObject({
      bodyHash: ingressRawHash(f.body),
    });
    const stale = {
      ...envelope,
      statement: {
        ...envelope.statement,
        originalOccurredAt: new Date(f.now.getTime() - 600_000).toISOString(),
      },
    };
    const signature = createHmac("sha256", f.proxySecret)
      .update(canonicalize(stale.statement as unknown as JsonValue))
      .digest("hex");
    await expect(gateway.verify(f.request(), { ...stale, signature }, f.now)).rejects.toThrow(
      "INGRESS_ORIGINAL_STALE",
    );
  });
  it("binds the attestation to exact route, raw body, source identity and configuration", async () => {
    const f = ingressFixture();
    const gateway = new TrustedIngressAdapter(
      f.policy,
      new JiraNativeIngressSource(f.policy, f.sourceKeys),
      f.proxyKeys,
    );
    const envelope = await gateway.attest(f.request(), f.now);
    for (const statement of [
      { ...envelope.statement, route: "/other" },
      { ...envelope.statement, sourceIdentity: "anonymous" },
      { ...envelope.statement, projectId: "other" },
      { ...envelope.statement, policyHash: "sha256:wrong" },
    ]) {
      const signature = createHmac("sha256", f.proxySecret)
        .update(canonicalize(statement as unknown as JsonValue))
        .digest("hex");
      await expect(
        gateway.verify(f.request(), { ...envelope, statement, signature }, f.now),
      ).rejects.toThrow();
    }
    await expect(
      gateway.verify({ ...f.request(), rawBody: new TextEncoder().encode("{}") }, envelope, f.now),
    ).rejects.toThrow();
    await expect(
      gateway.verify({ ...f.request(), method: "GET" }, envelope, f.now),
    ).rejects.toThrow();
    await expect(
      gateway.verify(
        f.request(),
        { ...envelope, keyRef: { ...envelope.keyRef, version: 99 } },
        f.now,
      ),
    ).rejects.toThrow();
  });
  it("allows bounded key overlap, rejects expired keys and snapshots caller-owned bytes before awaiting auth", async () => {
    const f = ingressFixture();
    const gateway = new TrustedIngressAdapter(
      f.policy,
      new JiraNativeIngressSource(f.policy, f.sourceKeys),
      f.proxyKeys,
    );
    const envelope = await gateway.attest(f.request(), f.now);
    await expect(
      gateway.verify(f.request(), envelope, new Date(f.now.getTime() + 3_600_001)),
    ).rejects.toThrow();
    const statement = { ...envelope.statement, signingKeyRef: f.policy.proxyKeys[1]!.ref };
    const overlap = {
      statement,
      keyRef: statement.signingKeyRef,
      signature: createHmac("sha256", f.proxySecret)
        .update(canonicalize(statement as unknown as JsonValue))
        .digest("hex"),
    };
    expect(await gateway.verify(f.request(), overlap, f.now)).toBeDefined();
    await expect(
      gateway.verify(f.request(), { ...envelope, keyRef: overlap.keyRef }, f.now),
    ).rejects.toThrow();
    const invalid = { ...f.policy, receiptRetentionSeconds: 1 };
    expect(
      () =>
        new TrustedIngressAdapter(
          invalid,
          new JiraNativeIngressSource(f.policy, f.sourceKeys),
          f.proxyKeys,
        ),
    ).toThrow();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new IngressHmacKeys(f.policy, f.policy.sourceKeys, {
      use: async (_ref, consume) => {
        await barrier;
        return consume(f.sourceSecret);
      },
    });
    const mutable = f.request(),
      expected = ingressRawHash(mutable.rawBody);
    const pending = new TrustedIngressAdapter(
      f.policy,
      new JiraNativeIngressSource(f.policy, held),
      f.proxyKeys,
    ).attest(mutable, f.now);
    mutable.rawBody.fill(0);
    release();
    expect((await pending).statement.bodyHash).toBe(expected);
  });
});
