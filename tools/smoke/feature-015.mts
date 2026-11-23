import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const api = process.env.AWP_DOCS_HTTP_URL ?? "http://localhost:5300";
const workspace = "15000000-0000-4000-8000-000000000001";
const project = "15000000-0000-4000-8000-000000000002";
const base = `${api}/workspaces/${workspace}/projects/${project}/documentation`;
const results: { check: string; status: number }[] = [];
async function session(personaKey: string) {
  const response = await fetch(`${api}/local/persona/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaKey }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as {
    accessToken: string;
    context: { workspaceId: string; projectId: string };
    grants: { permissions: string[] };
  };
}
async function check(
  name: string,
  url: string,
  status: number,
  token?: string,
  method = "GET",
  body?: unknown,
  version?: string,
) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      ...(version ? { "if-match": version } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, `${name}: ${await response.text()}`);
  results.push({ check: name, status: response.status });
}
const writer = await session("writer.docs"),
  lead = await session("lead.docs"),
  qa = await session("executor.alpha");
assert.equal(writer.context.workspaceId, workspace);
assert.equal(lead.context.projectId, project);
assert(!writer.grants.permissions.includes("docs.review"));
assert(lead.grants.permissions.includes("docs.review"));
await check("Писатель: список", base, 200, writer.accessToken);
await check("Лид: список", base, 200, lead.accessToken);
await check("Без токена", base, 401);
await check("Неверный токен", base, 401, "invalid");
await check("QA не читает документацию", base, 403, qa.accessToken);
await check(
  "Писатель не утверждает",
  `${base}/15000000-0000-4000-8000-000000000102/approve`,
  403,
  writer.accessToken,
  "POST",
  {},
  '"3"',
);
await check(
  "Подмена workspace",
  base.replace(workspace, "10000000-0000-4000-8000-000000000001"),
  403,
  writer.accessToken,
);
await check(
  "Подмена проекта",
  base.replace(project, "20000000-0000-4000-8000-000000000001"),
  403,
  writer.accessToken,
);
await check("Неизвестный документ", `${base}/${randomUUID()}`, 404, writer.accessToken);
await check("Подмена автора", base, 400, writer.accessToken, "POST", {
  title: "X",
  goal: "Y",
  audience: "Z",
  actorId: "lead",
});
await check(
  "Устаревшая версия",
  `${base}/15000000-0000-4000-8000-000000000101/save`,
  409,
  writer.accessToken,
  "POST",
  { body: "Не должно сохраниться" },
  '"99999"',
);
await check(
  "100 000 русских символов проходят JSON parser",
  `${base}/15000000-0000-4000-8000-000000000101/save`,
  409,
  writer.accessToken,
  "POST",
  { body: "Я".repeat(100_000) },
  '"99999"',
);
await check(
  "Лимит текста контролируется сервером",
  `${base}/15000000-0000-4000-8000-000000000101/save`,
  400,
  writer.accessToken,
  "POST",
  { body: "Я".repeat(100_001) },
  '"99999"',
);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), api, results }, null, 2));
