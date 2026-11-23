import { techWritingWorkspace } from "@awp/competency-tech-writing/ui";
import type { WorkspaceContribution } from "@awp/competency-ui-sdk";

import type { LocalSession } from "./navigation.ts";

const contributions: readonly WorkspaceContribution[] = [techWritingWorkspace];
export function workspaceContribution(session: LocalSession): WorkspaceContribution | undefined {
  return contributions.find((entry) => entry.workspaceKey === session.context.workspaceKey);
}
