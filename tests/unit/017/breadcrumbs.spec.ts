import { describe, expect, it } from "vitest";

import { breadcrumbs } from "../../../apps/web/src/workspace/breadcrumbs.ts";

describe("017 URL breadcrumbs", () => {
  it("has only one current page at home", () =>
    expect(breadcrumbs({ path: "/", label: "Обзор" })).toEqual([{ label: "Архив ордена" }]));
  it("never invents a project for workspace pages", () =>
    expect(
      breadcrumbs({ path: "/projects", label: "Проекты", projectId: "alpha", projectKey: "ALPHA" }),
    ).toEqual([{ label: "Архив ордена", href: "/" }, { label: "Проекты" }]));
  it("links detail to common list and uses entity project", () =>
    expect(
      breadcrumbs({ path: "/qa/requests", label: "Запросы", requestId: "b", projectKey: "BETA" }),
    ).toEqual([
      { label: "Архив ордена", href: "/" },
      { label: "Запросы", href: "/qa/requests" },
      { label: "BETA · Карточка запроса" },
    ]));
  it("links evidence via project to catalog", () =>
    expect(
      breadcrumbs({
        path: "/projects/b/evidence",
        label: "Материалы",
        projectId: "b",
        projectKey: "BETA",
      }).map((c) => c.href),
    ).toEqual(["/", "/projects", "/projects/b/onboarding", undefined]));
});
