import ts from "typescript";

/** Inspect call expressions: a method named import(input) is not a dynamic import. */
export function dynamicRuntimeLoads(source: string): readonly string[] {
  const file = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteral(specifier) || /^https?:/iu.test(specifier.text)) {
        violations.push(node.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return violations;
}
