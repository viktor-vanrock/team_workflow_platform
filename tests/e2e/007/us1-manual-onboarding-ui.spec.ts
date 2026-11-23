import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectOnboardingWorkspace } from "../../../packages/competency-qa/src/ui/project-onboarding.tsx";

const render = renderToStaticMarkup as (
  node: ReturnType<typeof ProjectOnboardingWorkspace>,
) => string;
const hash = `sha256:${"a".repeat(64)}`;

describe("Feature 007 US1 onboarding workspace", () => {
  it("renders exact accepted configuration, manual-only reasons and authorized actions", () => {
    const markup = render(
      ProjectOnboardingWorkspace({
        view: {
          project: {
            id: "project-a",
            key: "A",
            name: "Project A",
            owners: ["owner.alpha", "qa-lead.alpha"],
            classificationKey: "INTERNAL",
          },
          stage: "SHADOW",
          capabilityMode: "MANUAL_ONLY",
          operationalState: "ACTIVE",
          bindingRef: { id: "binding-a", version: 1, contentHash: hash },
          qaProjectContextRef: { id: "context-a", version: 1, contentHash: hash },
          gates: [
            { key: "L0", outcome: "PASS", safeIssueCodes: [] },
            { key: "C1", outcome: "PASS", safeIssueCodes: [] },
            { key: "N2", outcome: "PASS", safeIssueCodes: [] },
          ],
          probes: [
            {
              logicalRole: "QA_REQUEST_AUTHORITY",
              status: "AVAILABLE",
              validUntil: "2026-09-04T10:00:00.000Z",
            },
            {
              logicalRole: "PILOT_MESSAGING",
              status: "AVAILABLE",
              validUntil: "2026-09-04T10:00:00.000Z",
            },
          ],
          approval: { state: "CONSUMED", approverRole: "workspace-owner" },
          reasonCodes: ["AUTOMATION_REQUIREMENTS_UNSATISFIED"],
          canEvaluate: true,
          canRequestPublication: true,
        },
        onEvaluate: () => undefined,
        onRequestPublication: () => undefined,
      }),
    );

    expect(markup).toContain("Подключение проекта · Project A");
    expect(markup).toContain("Только ручная проверка");
    expect(markup).toContain("Автоматизированные сеансы заблокированы");
    expect(markup).toContain("Требования автоматизации не выполнены");
    expect(markup).toContain(`binding-a@1 · ${hash}`);
    expect(markup).toContain("Проверить условия подключения");
    expect(markup).toContain("Запросить публикацию привязки");
    expect(markup).not.toMatch(/password|token|cookie|secretValue/iu);
  });
});
