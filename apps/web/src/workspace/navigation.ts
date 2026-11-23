export interface WorkspaceProject {
  readonly projectId: string;
  readonly projectKey: string;
  readonly permissions?: readonly string[];
}
export interface PersonaOption {
  readonly key: string;
  readonly label: string;
}
export interface LocalSession {
  readonly accessToken: string;
  readonly persona: Readonly<{ key: string; label: string; kind?: "HUMAN" | "SERVICE" }>;
  readonly context: Readonly<{
    workspaceId: string;
    workspaceKey: string;
    projectId?: string;
    projectKey?: string;
  }>;
  readonly projects?: readonly WorkspaceProject[];
  readonly workspacePermissions?: readonly string[];
  readonly platformPermissions?: readonly string[];
  readonly workspaces?: readonly {
    workspaceId: string;
    workspaceKey: string;
    workspaceName: string;
    permissions?: readonly string[];
  }[];
  readonly grants: Readonly<{
    roles: readonly string[];
    permissions: readonly string[];
    classificationCeiling: string;
  }>;
}
export const personaDescriptions: Readonly<Record<string, string>> = {
  "writer.docs":
    "Техническая документация · ALPHA-DOCS. Ваши задания, сохранение черновиков и обработка замечаний лида.",
  "lead.docs":
    "Техническая документация · ALPHA-DOCS. Очередь ревью, возврат с замечаниями и утверждение точной редакции.",
  "requester.alpha":
    "Заказчик: опишите, что нужно проверить, отправьте запрос и следите за результатом. Только назначенные вам проекты.",
  "executor.alpha":
    "Исполнитель QA: подготовьте и выполните проверки, сохраните результаты. Все проекты рабочей области.",
  "executor.qa2": "Исполнитель QA: второй участник общей команды. Все проекты рабочей области.",
  "lead.alpha":
    "Руководитель QA: управляйте очередью, согласуйте решения и проверяйте результаты. Все проекты рабочей области.",
  "owner.local":
    "Администратор рабочей области. Управление её проектами и подключениями; независимые согласования.",
  "integration-admin.alpha":
    "Администратор: управляйте проектами, доступами и подключениями своей рабочей области. Второй участник для независимого согласования.",
  "viewer.beta": "Читатель: просматривайте доступные запросы всех проектов без внесения изменений.",
};
export const accessSection = {
  path: "/admin/users",
  label: "Пользователи и доступы",
  description: "Назначения ролей во всех рабочих областях",
  platformPermission: "platform.users.read",
} as const;
export const sections = [
  { path: "/", label: "Обзор", description: "Начало работы и следующие шаги" },
  {
    path: "/projects/hermes",
    label: "Создать проект с Hermes",
    description: "Опишите проект в диалоге",
    permission: "project.request.create",
  },
  {
    path: "/qa/new",
    label: "Новый запрос",
    description: "Расскажите, что нужно проверить",
    permission: "qa.request.create",
    project: true,
  },
  {
    path: "/qa/requests",
    label: "Запросы",
    description: "Выберите запрос и откройте его историю",
    permission: "work-item.read",
    project: true,
  },
  {
    path: "/qa/queue",
    label: "Очередь",
    description: "Приоритеты, загрузка и сроки работы",
    permission: "queue.portfolio.read",
    project: true,
  },
  {
    path: "/projects",
    label: "Проекты",
    description: "Подключение и готовность проектов",
    permission: "project.catalog.read",
  },
  {
    path: "/help",
    label: "Как работать",
    description: "Роли и путь запроса от идеи до результата",
  },
] as const;
export const extraSections = [
  {
    path: "/qa/intake-candidates",
    label: "Входящие обращения",
    description: "Обращения, которые ещё нужно принять в работу",
    permission: "work-item.read",
    project: true,
  },
  {
    path: "/qa/mattermost-intake",
    label: "Обращения из чата",
    description: "Приём обращений из Mattermost",
    permission: "qa.request.create",
    project: true,
  },
  {
    path: "/qa/hermes-proposals",
    label: "Предложения помощника",
    description: "Рекомендации Hermes для выбранного запроса",
    permission: "work-item.read",
    project: true,
  },
  {
    path: "/qa/automated-session",
    label: "Автоматические проверки",
    description: "Запуск и результаты проверок через GitLab",
    permission: "qa.automation.read",
    project: true,
  },
  {
    path: "/qa/notification-health",
    label: "Доставка уведомлений",
    description: "Состояние уведомлений проектов",
    permission: "work-item.read",
    project: true,
  },
  {
    path: "/projects/onboarding",
    label: "Настройки проекта",
    description: "Подключения и условия начала работы",
    permission: "project.onboarding.read",
    project: true,
  },
  {
    path: "/developer",
    label: "Инструменты разработки",
    description: "Демонстрационные операции и диагностика",
  },
] as const;
export type Section = Readonly<{
  path: string;
  label: string;
  description: string;
  permission?: string;
  platformPermission?: string;
  project?: boolean;
}>;
export function canVisit(section: Section, session: LocalSession) {
  return (
    (!(session.persona.kind === "SERVICE" || session.persona.key === "worker.local") ||
      !section.permission) &&
    (!section.permission || session.grants.permissions.includes(section.permission)) &&
    (!section.platformPermission ||
      !!session.platformPermissions?.includes(section.platformPermission)) &&
    (!section.project || !!session.projects?.length || !!session.context.projectId)
  );
}
