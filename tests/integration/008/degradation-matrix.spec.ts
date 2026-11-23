import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSafeCapabilityProbe } from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import {
  decidePilotDegradation,
  type PilotCapabilityTarget,
  type PilotDegradationInput,
  type PilotDegradedAction,
  type PilotDependency,
  projectPilotCapability,
} from "../../../packages/runtime-composition/src/pilot/degradation-policy.ts";

const now = Date.parse("2026-09-04T10:00:00Z"),
  ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` as const });
const providers: readonly PilotDependency[] = [
  "JIRA",
  "GITLAB",
  "MATTERMOST",
  "MODEL",
  "ARTIFACT_STORE",
  "OIDC",
];
const affected: Readonly<Record<PilotDependency, readonly PilotDegradedAction[]>> = {
  JIRA: ["JIRA_WRITE", "JIRA_FINAL_TRANSITION"],
  GITLAB: ["AUTOMATION_START", "AUTOMATION_RESULT"],
  MATTERMOST: ["CHAT_INTAKE", "CHAT_CONFIRM", "CHAT_NOTIFY"],
  MODEL: ["MODEL_RECOMMENDATION"],
  ARTIFACT_STORE: ["EVIDENCE_COMPLETE", "VERDICT_FINALIZE", "JIRA_FINAL_TRANSITION"],
  OIDC: ["OIDC_LOGIN", "OIDC_STEP_UP"],
};
const independent: readonly PilotDegradedAction[] = [
  "DRAFT_INTAKE",
  "MANUAL_NOTE",
  "MANUAL_SESSION",
  "REVIEW_EVIDENCE",
  "DETERMINISTIC_FORM",
  "HUMAN_DECISION",
  "ARTIFACT_METADATA",
];
const target = (provider: PilotDependency): PilotCapabilityTarget => ({
  workspaceId: "workspace",
  projectId: "project",
  bindingRef: ref(`${provider}-binding`),
  profileRef: ref(`${provider}-profile`),
  connectionRef: ref(`${provider}-connection`),
  validationReportRef: ref(`${provider}-validation`),
  logicalRole: provider,
  capabilityKey: `${provider.toLowerCase()}.health`,
  exactContractVersion: "1.0.0",
  operation: "health.read",
  environmentScope: "LOCAL",
});
const projection = (
  provider: PilotDependency,
  status: "AVAILABLE" | "UNAVAILABLE",
  reason: string,
) => {
  const t = target(provider),
    p = createSafeCapabilityProbe({
      ...t,
      probeId: `${provider}-probe`,
      status,
      safeIssueCodes: status === "AVAILABLE" ? [] : [reason],
      observedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 60000).toISOString(),
    });
  return projectPilotCapability({ target: t, probe: p, storedHash: p.contentHash, now });
};

let server: Server, origin: string;
const calls = new Map<string, number>();
beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture");
    const provider = url.pathname.slice(1);
    calls.set(provider, (calls.get(provider) ?? 0) + 1);
    const status = url.searchParams.get("status");
    if (status === "timeout") return;
    response.statusCode = Number(status ?? 200);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        status: response.statusCode === 200 ? "AVAILABLE" : "UNAVAILABLE",
        diagnostic: "PRIVATE_PROVIDER_DIAGNOSTIC",
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function observe(provider: PilotDependency, scenario: number | "timeout") {
  const before = calls.get(provider) ?? 0;
  try {
    const response = await fetch(`${origin}/${provider}?status=${scenario}`, {
      signal: AbortSignal.timeout(30),
    });
    return {
      fact: projection(
        provider,
        response.ok ? "AVAILABLE" : "UNAVAILABLE",
        `HTTP_${response.status}`,
      ),
      attempts: (calls.get(provider) ?? 0) - before,
    };
  } catch {
    return {
      fact: projection(provider, "UNAVAILABLE", "PROVIDER_TIMEOUT"),
      attempts: (calls.get(provider) ?? 0) - before,
    };
  }
}
function decide(action: PilotDegradedAction, facts: PilotDegradationInput["dependencies"]) {
  return decidePilotDegradation({
    action,
    authorized: true,
    now,
    dependencies: facts,
    requiredEvidenceComplete: true,
  });
}

describe("008 complete dependency degradation matrix", () => {
  it("maps every HTTP auth/rate/transient/timeout failure without retrying the probe or stopping independent work", async () => {
    for (const provider of providers)
      for (const scenario of [401, 403, 429, 500, 502, 503, 504, "timeout"] as const) {
        const observation = await observe(provider, scenario),
          facts = Object.fromEntries(
            providers.map((value) => [
              value,
              [value === provider ? observation.fact : projection(value, "AVAILABLE", "AVAILABLE")],
            ]),
          );
        expect(observation.attempts).toBe(1);
        for (const action of affected[provider]) expect(decide(action, facts).allowed).toBe(false);
        for (const action of independent) expect(decide(action, facts).allowed).toBe(true);
        if (provider === "OIDC")
          expect(
            decidePilotDegradation({
              action: "SESSION_CONTINUE",
              authorized: true,
              now,
              dependencies: facts,
              session: {
                issuedAt: new Date(now - 1000).toISOString(),
                expiresAt: new Date(now + 1000).toISOString(),
                maximumLifetimeMs: 60000,
                revoked: false,
              },
            }),
          ).toMatchObject({ allowed: true, reasonCodes: ["OIDC_UNAVAILABLE_EXISTING_SESSION"] });
      }
  });
  it("resumes only the affected action after a fresh positive observation and never leaks the response body", async () => {
    for (const provider of providers) {
      const healthy = await observe(provider, 200),
        facts = Object.fromEntries(
          providers.map((value) => [
            value,
            [value === provider ? healthy.fact : projection(value, "AVAILABLE", "AVAILABLE")],
          ]),
        );
      for (const action of affected[provider]) expect(decide(action, facts).allowed).toBe(true);
      expect(JSON.stringify(healthy.fact)).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
    }
  });
});
