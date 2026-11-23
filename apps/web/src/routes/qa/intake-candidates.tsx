import { QaCandidateIntake } from "@awp/competency-qa/ui";

export function IntakeCandidatesRoute(
  props: Readonly<{
    apiUrl: string;
    accessToken: string;
    workspaceId: string;
    projectId: string;
    permissions?: readonly string[];
  }>,
) {
  return <QaCandidateIntake {...props} />;
}
