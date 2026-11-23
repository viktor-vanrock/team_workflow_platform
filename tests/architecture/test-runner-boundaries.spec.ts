import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { browserTestFiles } from "../browser-test-files.ts";

describe("browser and node test discovery", () => {
  it("assigns every Playwright spec to exactly one runner", () => {
    const root = resolve(import.meta.dirname, "../e2e");
    const browserFiles = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile() && file.name.endsWith(".spec.ts"))
      .flatMap((file) => {
        const path = resolve(file.parentPath, file.name);
        const source = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const declarations = source.statements.filter(ts.isImportDeclaration);
        const imports = declarations.flatMap((statement) =>
          ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [],
        );
        // A Vitest integration may use Chromium as a client without using the Playwright runner.
        const usesBrowserRunner = declarations.some((statement) => {
          const bindings = statement.importClause?.namedBindings;
          return (
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text === "@playwright/test" &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.some(
              (element) => (element.propertyName ?? element.name).text === "test",
            )
          );
        });
        if (!usesBrowserRunner) return [];
        expect(imports, path).not.toContain("vitest");
        return [relative(root, path).replaceAll("\\", "/")];
      });
    expect(new Set(browserTestFiles).size).toBe(browserTestFiles.length);
    expect([...browserTestFiles].sort()).toEqual(browserFiles.sort());
  });
});
