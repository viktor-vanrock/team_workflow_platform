import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

const uiFiles = [
  "apps/web/index.html",
  "apps/web/src/App.tsx",
  "apps/web/src/workspace/local-workspace.tsx",
  "apps/web/src/workspace/navigation.ts",
  "apps/web/src/workspace/workspace-home.tsx",
  "apps/web/src/workspace/developer-tools.tsx",
  "apps/web/src/routes/work-item-detail.tsx",
  "apps/web/src/routes/pilot/readiness.tsx",
  "apps/web/src/routes/pilot/dead-letters.tsx",
  "apps/web/src/routes/pilot/pilot-run.tsx",
  "apps/web/src/routes/pilot/recovery.tsx",
  "apps/web/src/routes/projects/evidence.tsx",
  "apps/web/src/routes/projects/onboarding.tsx",
  "apps/web/src/routes/projects/project-catalog.tsx",
  "apps/web/src/routes/qa/automated-session.tsx",
  "apps/web/src/routes/qa/hermes-proposals.tsx",
  "apps/web/src/routes/qa/mattermost-intake.tsx",
  "apps/web/src/routes/qa/notification-health.tsx",
  "apps/web/src/routes/qa/queue-workspace.tsx",
  "apps/web/src/routes/qa/queue.tsx",
  "packages/competency-qa/src/rules/dor-rules.v1.ts",
  "packages/competency-qa/src/ui/automated-session-executor.tsx",
  "packages/competency-qa/src/ui/automated-session.tsx",
  "packages/competency-qa/src/ui/candidate-intake.tsx",
  "packages/competency-qa/src/ui/confirmed-backlog.tsx",
  "packages/competency-qa/src/ui/contribution.tsx",
  "packages/competency-qa/src/ui/evidence-integrity.tsx",
  "packages/competency-qa/src/ui/evidence-review.tsx",
  "packages/competency-qa/src/ui/findings-defects.tsx",
  "packages/competency-qa/src/ui/hermes-proposals.tsx",
  "packages/competency-qa/src/ui/intake.tsx",
  "packages/competency-qa/src/ui/manual-session-executor.tsx",
  "packages/competency-qa/src/ui/notification-health.tsx",
  "packages/competency-qa/src/ui/operational-authority-workspace.tsx",
  "packages/competency-qa/src/ui/project-onboarding.tsx",
  "packages/competency-qa/src/ui/queue-item.tsx",
  "packages/competency-qa/src/ui/queue-workspace.tsx",
  "packages/competency-qa/src/ui/readiness-panel.tsx",
  "packages/competency-qa/src/ui/request-input-history.tsx",
  "packages/competency-qa/src/ui/required-session-plan.tsx",
  "packages/competency-qa/src/ui/session-planner.tsx",
  "packages/competency-qa/src/ui/verdict-completion.tsx",
  "packages/platform-ui/src/integration-health/delivery-health.tsx",
  "packages/platform-ui/src/operational-authority/operational-authority-panel.tsx",
  "packages/platform-ui/src/operational-authority/operational-conflict-panel.tsx",
] as const;

const preservedTerms =
  /\b(?:QA|Jira|GitLab|Mattermost|Hermes|API|MFA|OIDC|IAM|PKCE|BFF|SLA|WIP|CI|ID|RPO|RTO|ETag|DoR|DoD|CAS|JSON|HTTP|UI|Mock Hub|Chromium|Firefox|WebKit|sha256)\b/gu;
const technicalOnly =
  /^(?:[A-Z][A-Z0-9_]*(?:\s*[|,]\s*[A-Z][A-Z0-9_]*)*|[a-z0-9_.@/#:-]+|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*|\d+(?:px|rem|em)\s+[a-z]+|W\/[^\s]+)$/u;

interface UiStringCandidate {
  readonly text: string;
  readonly position: number;
}

function isOrdinaryEnglish(text: string): boolean {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized || technicalOnly.test(normalized)) return false;
  const withoutPreservedTerms = normalized.replace(preservedTerms, "");
  return /[A-Za-z]{3,}/u.test(withoutPreservedTerms);
}

function stringsWithin(node: ts.Node, sourceFile: ts.SourceFile): UiStringCandidate[] {
  const values: UiStringCandidate[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isStringLiteralLike(current)) {
      values.push({ text: current.text, position: current.getStart(sourceFile) });
      return;
    }
    if (ts.isTemplateExpression(current)) {
      values.push({ text: current.head.text, position: current.head.getStart(sourceFile) });
      for (const span of current.templateSpans)
        values.push({ text: span.literal.text, position: span.literal.getStart(sourceFile) });
      return;
    }
    if (
      current !== node &&
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current))
    )
      return;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return values;
}

function extractUiStrings(file: string, source: string): readonly UiStringCandidate[] {
  if (file.endsWith(".html")) {
    const title = /<title>([^<]+)<\/title>/u.exec(source);
    return title ? [{ text: title[1]!, position: title.index }] : [];
  }
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const values: UiStringCandidate[] = [];
  const add = (node: ts.Node | undefined): void => {
    if (node) values.push(...stringsWithin(node, sourceFile));
  };
  const visit = (node: ts.Node): void => {
    // Styling expressions contain CSS syntax, not user-facing copy.
    if (ts.isJsxAttribute(node) && ["sx", "style"].includes(node.name.getText(sourceFile))) return;
    if (ts.isJsxText(node))
      values.push({ text: node.getText(sourceFile), position: node.getStart(sourceFile) });
    if (ts.isJsxExpression(node)) add(node.expression);
    if (
      ts.isJsxAttribute(node) &&
      ["aria-label", "label", "placeholder", "title", "alt"].includes(node.name.getText(sourceFile))
    )
      add(node.initializer);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/^(?:useState|setNotice|setError)$/u.test(callee)) add(node.arguments[0]);
      if (file.endsWith("dor-rules.v1.ts") && callee === "hard") add(node.arguments[3]);
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "Error")
      add(node.arguments?.[0]);
    if (
      ts.isVariableDeclaration(node) &&
      /(?:labels?|tabs?|choices?|presets?|copy|messages?)$/iu.test(node.name.getText(sourceFile))
    )
      add(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

describe("граница русской локализации UI", () => {
  it("distinguishes CSS from actual user-facing copy", () => {
    const candidates = extractUiStrings(
      "sample.tsx",
      '<Box sx={{border: "1px solid red"}}><Button label="Create request">Создать запрос</Button></Box>',
    );
    expect(
      candidates.filter(({ text }) => isOrdinaryEnglish(text)).map(({ text }) => text),
    ).toEqual(["Create request"]);
  });
  it.each(uiFiles)("не содержит обычный английский текст: %s", (file) => {
    const source = readFileSync(resolve(repositoryRoot, file), "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const suspectLines = extractUiStrings(file, source)
      .filter(({ text }) => isOrdinaryEnglish(text))
      .map(
        ({ text, position }) =>
          `${String(sourceFile.getLineAndCharacterOfPosition(position).line + 1)}: ${text.replace(/\s+/gu, " ").trim()}`,
      )
      .filter((value, index, values) => values.indexOf(value) === index);
    expect(suspectLines, suspectLines.join("\n")).toEqual([]);
  });
});
