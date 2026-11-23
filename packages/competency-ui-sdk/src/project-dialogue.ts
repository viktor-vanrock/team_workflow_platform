/** Wire contract shared by the project registration dialogue and its browser client. */
export interface ProjectDialogueDraft {
  readonly key: string;
  readonly name?: string;
  readonly purpose?: string;
}
export interface ProjectDialogueView {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly state: "COLLECTING" | "READY" | "CREATED";
  readonly draft: ProjectDialogueDraft;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly projectId?: string;
}
