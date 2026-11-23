import { type APIRequestContext, expect, test } from "@playwright/test";

const apiUrl = process.env.AWP_API_URL ?? "http://127.0.0.1:3000";
const personas = [
  "owner.local",
  "integration-admin.alpha",
  "requester.alpha",
  "executor.alpha",
  "executor.qa2",
  "viewer.beta",
] as const;
type Persona = (typeof personas)[number];

async function exchange(request: APIRequestContext, personaKey: Persona): Promise<string> {
  const response = await request.post(`${apiUrl}/local/persona/exchange`, { data: { personaKey } });
  expect(response.status(), `${personaKey} session exchange`).toBe(201);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

function authorization(token: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${token}` };
}

test("local walking-skeleton personas are enforced at the backend boundary", async ({
  request,
}) => {
  await test.step("removed and service personas cannot open human sessions", async () => {
    for (const personaKey of ["limited.alpha", "outsider.delta", "auditor.local", "worker.local"]) {
      const response = await request.post(`${apiUrl}/local/persona/exchange`, {
        data: { personaKey },
      });
      expect(response.status()).toBe(403);
    }
  });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const sessions = Object.fromEntries(
    await Promise.all(
      personas.map(async (persona) => [persona, await exchange(request, persona)] as const),
    ),
  ) as Record<Persona, string>;

  await test.step("requesters create only in their own seeded project", async () => {
    for (const persona of ["requester.alpha"] as const) {
      const response = await request.post(`${apiUrl}/local/walking-skeleton/dummy`, {
        headers: authorization(sessions[persona]),
        data: { sampleName: `${persona}-${suffix}`, message: "persona matrix" },
      });
      expect(response.status(), `${persona} work-item.create`).toBe(201);
      expect(await response.json()).toMatchObject({ state: "OPEN", rowVersion: 1 });
    }
    for (const persona of [
      "owner.local",
      "integration-admin.alpha",
      "executor.alpha",
      "viewer.beta",
    ] as const) {
      const response = await request.post(`${apiUrl}/local/walking-skeleton/dummy`, {
        headers: authorization(sessions[persona]),
        data: { sampleName: `${persona}-${suffix}`, message: "must be denied" },
      });
      expect(response.status(), `${persona} work-item.create denial`).toBe(403);
    }
  });

  let approvalId = "";
  await test.step("both QA executors can create connector commands", async () => {
    for (const persona of ["executor.alpha", "executor.qa2"] as const) {
      const response = await request.post(`${apiUrl}/local/walking-skeleton/commands`, {
        headers: authorization(sessions[persona]),
        data: {
          recordKey: `${persona}-${suffix}`,
          message: "allowed effect",
          clientRequestKey: `${persona}-${suffix}`,
          approvalRequired: false,
        },
      });
      expect(response.status(), `${persona} command.execute`).toBe(201);
      expect(await response.json()).toMatchObject({ state: "CONFIRMED", effectCount: 1 });
    }
    const awaiting = await request.post(`${apiUrl}/local/walking-skeleton/commands`, {
      headers: authorization(sessions["executor.alpha"]),
      data: {
        recordKey: `approval-${suffix}`,
        message: "exact approval",
        clientRequestKey: `approval-${suffix}`,
        approvalRequired: true,
      },
    });
    expect(awaiting.status()).toBe(201);
    const awaitingBody = (await awaiting.json()) as {
      approvalId: string;
      state: string;
      effectCount: number;
    };
    expect(awaitingBody).toMatchObject({ state: "AWAITING_APPROVAL", effectCount: 0 });
    approvalId = awaitingBody.approvalId;

    for (const persona of [
      "owner.local",
      "integration-admin.alpha",
      "requester.alpha",
      "viewer.beta",
    ] as const) {
      const response = await request.post(`${apiUrl}/local/walking-skeleton/commands`, {
        headers: authorization(sessions[persona]),
        data: {
          recordKey: `denied-${persona}-${suffix}`,
          message: "must be denied",
          clientRequestKey: `denied-${persona}-${suffix}`,
        },
      });
      expect(response.status(), `${persona} command.execute denial`).toBe(403);
    }
  });

  await test.step("Approval cannot be decided by initiators or unrelated human personas", async () => {
    for (const persona of ["requester.alpha", "executor.alpha", "viewer.beta"] as const) {
      const response = await request.post(
        `${apiUrl}/local/walking-skeleton/approvals/${approvalId}/approve`,
        { headers: authorization(sessions[persona]), data: {} },
      );
      expect(response.status(), `${persona} approval.decide denial`).toBe(403);
    }
    const approved = await request.post(
      `${apiUrl}/local/walking-skeleton/approvals/${approvalId}/approve`,
      { headers: authorization(sessions["owner.local"]), data: {} },
    );
    expect(approved.status()).toBe(201);
    expect(await approved.json()).toMatchObject({ state: "CONFIRMED", effectCount: 1 });
  });

  await test.step("artifact scope, permission and classification are rechecked server-side", async () => {
    const overview = await request.get(`${apiUrl}/local/walking-skeleton`, {
      headers: authorization(sessions["requester.alpha"]),
    });
    expect(overview.status()).toBe(200);
    const artifacts = (
      (await overview.json()) as { artifacts: Array<{ id: string; file_name: string }> }
    ).artifacts;
    const publicId = artifacts.find(
      ({ file_name }) => file_name === "local-walking-skeleton.txt",
    )?.id;
    const restrictedId = artifacts.find(({ file_name }) => file_name === "alpha.txt")?.id;
    expect(publicId).toBeTruthy();
    expect(restrictedId).toBeTruthy();

    for (const persona of [
      "requester.alpha",
      "owner.local",
      "integration-admin.alpha",
      "executor.alpha",
      "executor.qa2",
    ] as const) {
      const response = await request.get(
        `${apiUrl}/local/walking-skeleton/artifacts/${publicId}/content`,
        { headers: authorization(sessions[persona]) },
      );
      expect(response.status(), `${persona} public artifact`).toBe(200);
    }
    const ownerRestricted = await request.get(
      `${apiUrl}/local/walking-skeleton/artifacts/${restrictedId}/content`,
      { headers: authorization(sessions["owner.local"]) },
    );
    expect(ownerRestricted.status(), "owner RESTRICTED ceiling").toBe(200);

    for (const persona of ["viewer.beta"] as const) {
      const response = await request.get(
        `${apiUrl}/local/walking-skeleton/artifacts/${publicId}/content`,
        { headers: authorization(sessions[persona]) },
      );
      expect(response.status(), `${persona} artifact permission/scope denial`).toBe(403);
    }
  });
});
