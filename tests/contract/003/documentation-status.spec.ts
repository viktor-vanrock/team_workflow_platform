import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(workspace, relativePath), "utf8");
}

describe("Feature 003 documentation status", () => {
  it("distinguishes verified local implementation, optional live non-prod, and excluded production writes", () => {
    const specification = read("specs/003-jira-operational-authority/spec.md");
    const plan = read("specs/003-jira-operational-authority/plan.md");
    const tasks = read("specs/003-jira-operational-authority/tasks.md");
    const readme = read("README.md");

    expect(specification).toContain("**Статус:** Реализовано и локально подтверждено");
    expect(specification).not.toContain("**Статус:** Planned");

    expect(plan).toContain("**Implementation status:** Locally verified");
    expect(plan).not.toContain("The current repository is not ready to implement 003");
    expect(plan).not.toContain("Implementation status remains **BLOCKED BY PREREQUISITES**");

    expect(tasks).toContain("**Implementation status**: Locally verified");
    expect(tasks).toContain("- **Total: 163 tasks.**");
    expect(tasks).toContain("- [x] T163 ");

    expect(readme).toContain("Jira хранит операционное состояние принятого запроса");
    expect(readme).toContain("pnpm ci:003");
    expect(readme).toContain("pnpm verify:003:evidence");
    expect(readme).toContain("SKIPPED_GATED");
    expect(readme).toContain("Запись в production Jira запрещена");

    for (const document of [specification, plan, tasks]) {
      expect(document).toContain("SKIPPED_GATED");
      expect(document).toMatch(/production (?:Jira )?writes (?:are |remain )?excluded/i);
    }
  });
});
