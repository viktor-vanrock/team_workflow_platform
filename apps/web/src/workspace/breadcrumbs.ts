export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}
export function breadcrumbs(input: {
  path: string;
  label: string;
  projectId?: string;
  projectKey?: string;
  requestId?: string;
  documentId?: string;
  rootLabel?: string;
}): readonly Breadcrumb[] {
  const root = { label: input.rootLabel ?? "Архив ордена", href: "/" };
  if (input.path === "/projects/new")
    return [root, { label: "Проекты", href: "/projects" }, { label: "Новый проект" }];
  if (/^\/projects\/[^/]+\/edit$/u.test(input.path) && input.projectId)
    return [
      root,
      { label: "Проекты", href: "/projects" },
      { label: input.projectKey ?? "Проект", href: `/projects/${input.projectId}/onboarding` },
      { label: "Редактирование проекта" },
    ];
  if (input.path === "/") return [{ label: root.label }];
  if (/^\/projects\/[^/]+\/(onboarding|evidence)$/u.test(input.path) && input.projectId) {
    return [
      root,
      { label: "Проекты", href: "/projects" },
      ...(input.path.endsWith("/evidence")
        ? [{ label: input.projectKey ?? "Проект", href: `/projects/${input.projectId}/onboarding` }]
        : []),
      {
        label: input.path.endsWith("/evidence")
          ? "Материалы проекта"
          : `Проект ${input.projectKey ?? ""}`,
      },
    ];
  }
  if (input.path === "/qa/requests" && input.requestId)
    return [
      root,
      { label: "Запросы", href: "/qa/requests" },
      { label: `${input.projectKey ? `${input.projectKey} · ` : ""}Карточка запроса` },
    ];
  if (input.path === "/docs/documents" && input.documentId)
    return [root, { label: "Документы", href: "/docs/documents" }, { label: "Карточка документа" }];
  if (input.path.startsWith("/docs/") && input.path !== "/docs/documents")
    return [root, { label: "Документы", href: "/docs/documents" }, { label: input.label }];
  return [root, { label: input.label }];
}
