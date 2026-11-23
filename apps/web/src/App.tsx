import { lazy, Suspense } from "react";

import { Box } from "@awp/platform-ui";

import { CorporateAccessApp } from "./workspace/corporate-access.tsx";
import { LocalWorkspaceApp } from "./workspace/local-workspace.tsx";

const PilotReadinessRoute = lazy(async () => {
  const route = await import("./routes/pilot/readiness.tsx");
  return { default: route.PilotReadinessRoute };
});

const PilotDeadLettersRoute = lazy(async () => {
  const route = await import("./routes/pilot/dead-letters.tsx");
  return { default: route.PilotDeadLettersRoute };
});
const PilotRecoveryRoute = lazy(async () => {
  const route = await import("./routes/pilot/recovery.tsx");
  return { default: route.PilotRecoveryRoute };
});
const PilotRunRoute = lazy(async () => {
  const route = await import("./routes/pilot/pilot-run.tsx");
  return { default: route.PilotRunRoute };
});

const webEnvironment = import.meta.env as Readonly<Record<string, string | undefined>>;
const composition = webEnvironment.VITE_AWP_COMPOSITION ?? "foundation";

export function App() {
  const path = window.location.pathname;
  if (
    webEnvironment.VITE_AWP_AUTH_MODE === "corporate" &&
    (["/", "/access", "/admin/users", "/projects", "/projects/new"].includes(path) ||
      /^\/projects\/[^/]+\/edit$/u.test(path))
  )
    return <CorporateAccessApp />;
  const pilotRun = /^\/workspaces\/([^/]+)\/projects\/([^/]+)\/pilot\/runs\/([^/]+)$/u.exec(path);
  if (path === "/pilot/run" || pilotRun)
    return (
      <Suspense fallback={<Box role="status">Загрузка отчёта пилота…</Box>}>
        <PilotRunRoute
          {...(pilotRun
            ? {
                initialScope: {
                  workspaceId: pilotRun[1]!,
                  projectId: pilotRun[2]!,
                  runId: decodeURIComponent(pilotRun[3]!),
                },
              }
            : {})}
        />
      </Suspense>
    );
  const deadLetters = /^\/workspaces\/([^/]+)\/projects\/([^/]+)\/pilot\/dead-letters$/u.exec(path);
  if (path === "/pilot/dead-letters" || deadLetters)
    return (
      <Suspense fallback={<Box role="status">Загрузка диагностики…</Box>}>
        <PilotDeadLettersRoute
          {...(deadLetters
            ? { initialScope: { workspaceId: deadLetters[1]!, projectId: deadLetters[2]! } }
            : {})}
        />
      </Suspense>
    );
  const recovery = /^\/workspaces\/([^/]+)\/projects\/([^/]+)\/pilot\/recovery$/u.exec(path);
  if (path === "/pilot/recovery" || recovery)
    return (
      <Suspense fallback={<Box role="status">Загрузка данных о восстановлении…</Box>}>
        <PilotRecoveryRoute
          {...(recovery
            ? { initialScope: { workspaceId: recovery[1]!, projectId: recovery[2]! } }
            : {})}
        />
      </Suspense>
    );
  const pilot =
    /^\/workspaces\/([^/]+)\/projects\/([^/]+)\/pilot\/deployments\/([^/]+)\/readiness$/u.exec(
      path,
    );
  if (
    path === "/pilot/readiness" ||
    pilot ||
    ["qa-jira-gitlab-mattermost-development", "qa-jira-gitlab-mattermost-test"].includes(
      composition,
    )
  ) {
    return (
      <Suspense
        fallback={
          <Box role="status" sx={{ p: 4 }}>
            Загрузка готовности пилота…
          </Box>
        }
      >
        <PilotReadinessRoute
          {...(pilot
            ? {
                initialSelection: {
                  workspaceId: pilot[1]!,
                  projectId: pilot[2]!,
                  deploymentId: pilot[3]!,
                },
                returnPath: path,
              }
            : {})}
        />
      </Suspense>
    );
  }
  return <LocalWorkspaceApp />;
}
