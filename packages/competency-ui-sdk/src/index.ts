import type { ComponentType } from "react";

/** Additive, statically imported workspace UI extension. Authorization remains on the server. */
export interface WorkspaceSection {
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly permission?: string;
  readonly project?: boolean;
}
export interface WorkspaceContributionProps {
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly permissions: readonly string[];
  readonly location: string;
  readonly navigate: (path: string) => void;
}
export interface WorkspaceContribution {
  readonly key: string;
  readonly label: string;
  readonly workspaceKey: string;
  readonly sections: (permissions: readonly string[]) => readonly WorkspaceSection[];
  readonly Component: ComponentType<WorkspaceContributionProps>;
}

export interface WorkItemDetailContributionProps<TData = unknown> {
  readonly workItemId: string;
  readonly data: TData;
}

export interface WorkItemDetailContribution<TData = unknown> {
  readonly slot: "WORK_ITEM_DETAIL_TAB";
  readonly routeSegment: string;
  readonly label: string;
  readonly componentRef: string;
  readonly Component: ComponentType<WorkItemDetailContributionProps<TData>>;
}

export type StaticUiContribution =
  WorkItemDetailContribution<never> | WorkItemDetailContribution<unknown>;

export function defineWorkItemDetailContribution<TData>(
  contribution: WorkItemDetailContribution<TData>,
): WorkItemDetailContribution<TData> {
  if (/^(?:https?:|data:|javascript:)/u.test(contribution.componentRef)) {
    throw new Error("Remote UI component references are forbidden");
  }
  return Object.freeze(contribution);
}

export type { ProjectDialogueDraft, ProjectDialogueView } from "./project-dialogue.ts";
