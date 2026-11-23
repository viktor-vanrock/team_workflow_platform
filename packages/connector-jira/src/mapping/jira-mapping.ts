export type JiraMappingExpression =
  | Readonly<{ op: "literal"; value: unknown }>
  | Readonly<{ op: "source"; path: string }>
  | Readonly<{
      op: "coalesce" | "concat" | "array";
      expressions: readonly JiraMappingExpression[];
      separator?: string;
    }>
  | Readonly<{ op: "lookup"; tableKey: string; expression: JiraMappingExpression }>
  | Readonly<{
      op: "format-date";
      expression: JiraMappingExpression;
      format: "YYYY-MM-DD" | "ISO-8601";
    }>
  | Readonly<{ op: "object"; fields: Readonly<Record<string, JiraMappingExpression>> }>
  | Readonly<{ op: "omit-if-null"; expression: JiraMappingExpression }>;
export interface JiraMappingProgram {
  readonly outputFieldAllowlist: readonly string[];
  readonly limits: Readonly<{ maxDepth: number; maxNodes: number; maxOutputBytes: number }>;
  readonly expression: JiraMappingExpression;
  readonly lookupTables: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly allowedSourcePaths: readonly string[];
}

function inspect(
  expression: unknown,
  program: Omit<JiraMappingProgram, "expression">,
  state: { nodes: number },
  depth: number,
): JiraMappingExpression {
  if (!expression || typeof expression !== "object" || Array.isArray(expression))
    throw new Error("MAPPING_NODE_INVALID");
  if (++state.nodes > program.limits.maxNodes || depth > program.limits.maxDepth)
    throw new Error("MAPPING_RESOURCE_LIMIT_EXCEEDED");
  const node = expression as Record<string, unknown>;
  const op = node.op;
  if (
    ![
      "literal",
      "source",
      "coalesce",
      "lookup",
      "concat",
      "format-date",
      "array",
      "object",
      "omit-if-null",
    ].includes(String(op))
  )
    throw new Error("MAPPING_OPERATION_FORBIDDEN");
  if (op === "source") {
    if (
      typeof node.path !== "string" ||
      !program.allowedSourcePaths.includes(node.path) ||
      /secret|token|password|credential/iu.test(node.path)
    )
      throw new Error("MAPPING_SOURCE_PATH_FORBIDDEN");
  } else if (op === "object") {
    if (!node.fields || typeof node.fields !== "object" || Array.isArray(node.fields))
      throw new Error("MAPPING_OBJECT_INVALID");
    for (const [field, child] of Object.entries(node.fields as Record<string, unknown>)) {
      if (!program.outputFieldAllowlist.includes(field))
        throw new Error("MAPPING_TARGET_FIELD_FORBIDDEN");
      inspect(child, program, state, depth + 1);
    }
  } else if (["coalesce", "concat", "array"].includes(String(op))) {
    if (!Array.isArray(node.expressions)) throw new Error("MAPPING_NODE_INVALID");
    node.expressions.forEach((child) => {
      inspect(child, program, state, depth + 1);
    });
  } else if (["lookup", "format-date", "omit-if-null"].includes(String(op)))
    inspect(node.expression, program, state, depth + 1);
  return structuredClone(node) as JiraMappingExpression;
}

export function compileJiraMapping(
  input: Readonly<{
    outputFieldAllowlist: readonly string[];
    limits: JiraMappingProgram["limits"];
    expression: unknown;
    lookupTables: JiraMappingProgram["lookupTables"];
  }>,
  allowedSourcePaths: readonly string[],
): JiraMappingProgram {
  if (
    input.outputFieldAllowlist.length === 0 ||
    input.limits.maxDepth <= 0 ||
    input.limits.maxNodes <= 0 ||
    input.limits.maxOutputBytes <= 0
  )
    throw new Error("MAPPING_LIMITS_INVALID");
  const base = {
    outputFieldAllowlist: Object.freeze([...input.outputFieldAllowlist]),
    limits: Object.freeze({ ...input.limits }),
    lookupTables: Object.freeze(structuredClone(input.lookupTables)),
    allowedSourcePaths: Object.freeze([...allowedSourcePaths]),
  };
  const expression = inspect(input.expression, base, { nodes: 0 }, 1);
  return Object.freeze({ ...base, expression: Object.freeze(expression) });
}

const omitted = Symbol("omitted");
function valueAt(input: Readonly<Record<string, unknown>>, path: string): unknown {
  return path
    .slice(2)
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      input,
    );
}
function evaluate(
  expression: JiraMappingExpression,
  program: JiraMappingProgram,
  input: Readonly<Record<string, unknown>>,
): unknown {
  switch (expression.op) {
    case "literal":
      return structuredClone(expression.value);
    case "source":
      return structuredClone(valueAt(input, expression.path));
    case "coalesce":
      return expression.expressions
        .map((item) => evaluate(item, program, input))
        .find((item) => item !== null && item !== undefined);
    case "lookup":
      return program.lookupTables[expression.tableKey]?.[
        String(evaluate(expression.expression, program, input))
      ];
    case "concat":
      return expression.expressions
        .map((item) => evaluate(item, program, input))
        .filter((item) => item !== null && item !== undefined)
        .join(expression.separator ?? "");
    case "format-date": {
      const date = new Date(String(evaluate(expression.expression, program, input)));
      if (!Number.isFinite(date.getTime())) throw new Error("MAPPING_DATE_INVALID");
      return expression.format === "YYYY-MM-DD"
        ? date.toISOString().slice(0, 10)
        : date.toISOString();
    }
    case "array":
      return expression.expressions
        .map((item) => evaluate(item, program, input))
        .filter((item) => item !== omitted);
    case "object":
      return Object.fromEntries(
        Object.entries(expression.fields).flatMap(([key, child]) => {
          const value = evaluate(child, program, input);
          return value === omitted ? [] : [[key, value]];
        }),
      );
    case "omit-if-null": {
      const value = evaluate(expression.expression, program, input);
      return value === null || value === undefined ? omitted : value;
    }
  }
}
export function evaluateJiraMapping(
  program: JiraMappingProgram,
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const output = evaluate(program.expression, program, input);
  if (!output || typeof output !== "object" || Array.isArray(output))
    throw new Error("MAPPING_OUTPUT_OBJECT_REQUIRED");
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > program.limits.maxOutputBytes)
    throw new Error("MAPPING_OUTPUT_TOO_LARGE");
  return Object.freeze(output as Record<string, unknown>);
}
