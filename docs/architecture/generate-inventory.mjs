import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, "../..");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.name === "node_modules"
        ? []
        : e.isDirectory()
          ? files(path.join(dir, e.name))
          : [path.join(dir, e.name)],
    );
const packages = ["apps", "packages"].flatMap((base) =>
  fs.readdirSync(path.join(root, base)).flatMap((name) => {
    const dir = path.join(root, base, name),
      manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) return [];
    const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
    return [
      {
        name: json.name,
        path: rel(dir),
        version: json.version,
        declaredDependencies: Object.keys(json.dependencies ?? {}).filter((x) =>
          x.startsWith("@awp/"),
        ),
        sourceDependencies: [],
        sourceFiles: 0,
      },
    ];
  }),
);
const tables = [],
  controllers = [],
  modules = [],
  sourceHashes = [];
const literal = (n) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
const property = (obj, name) =>
  obj && ts.isObjectLiteralExpression(obj)
    ? obj.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === name,
      )?.initializer
    : undefined;
const decorators = (n) =>
  (ts.canHaveDecorators(n) ? (ts.getDecorators(n) ?? []) : [])
    .map((d) => d.expression)
    .filter(ts.isCallExpression);
const decoration = (n, name) => decorators(n).find((d) => d.expression.getText() === name);
const values = (n) =>
  !n ? [] : ts.isArrayLiteralExpression(n) ? n.elements.map((x) => x.getText()) : [n.getText()];

for (const pkg of packages) {
  const source = path.join(root, pkg.path, "src");
  if (!fs.existsSync(source)) continue;
  const imports = new Set();
  for (const file of files(source).filter(
    (f) => /\.(ts|tsx|mts)$/.test(f) && !/\.(spec|test)\./.test(f),
  )) {
    const code = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(
      file,
      code,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    pkg.sourceFiles++;
    sourceHashes.push({
      path: rel(file),
      sha256: crypto.createHash("sha256").update(code).digest("hex"),
    });
    const location = (node) => ({
      path: rel(file),
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
    });
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const name = literal(node.moduleSpecifier);
        if (name?.startsWith("@awp/")) imports.add(name.split("/").slice(0, 2).join("/"));
      }
      let tableName, entityName, object;
      if (ts.isNewExpression(node) && node.expression.getText(ast) === "EntitySchema") {
        object = node.arguments?.[0];
        tableName = literal(property(object, "tableName"));
        entityName = literal(property(object, "name"));
      } else if (ts.isCallExpression(node) && node.expression.getText(ast) === "entity") {
        entityName = literal(node.arguments[0]);
        tableName = literal(node.arguments[1]);
      }
      if (tableName)
        tables.push({ owner: pkg.name, name: tableName, entity: entityName, ...location(node) });
      if (ts.isClassDeclaration(node)) {
        const controller = decoration(node, "Controller");
        if (controller) {
          const base =
            literal(controller.arguments[0]) ??
            (controller.arguments.length ? controller.arguments[0].getText(ast) : "");
          const methods = node.members.flatMap((member) =>
            decorators(member).flatMap((dec) => {
              const verb = dec.expression.getText(ast).toUpperCase();
              if (
                !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"].includes(verb)
              )
                return [];
              const suffix =
                literal(dec.arguments[0]) ??
                (dec.arguments.length ? dec.arguments[0].getText(ast) : "");
              return [
                {
                  verb,
                  path: "/" + [base, suffix].filter(Boolean).join("/").replace(/^\/+/, ""),
                  method: member.name?.getText(ast),
                  ...location(member),
                },
              ];
            }),
          );
          controllers.push({
            owner: pkg.name,
            name: node.name?.text,
            base,
            guards: values(decoration(node, "UseGuards")?.arguments[0]),
            methods,
            ...location(node),
          });
        }
        const module = decoration(node, "Module");
        if (module)
          modules.push({
            name: node.name?.text,
            imports: values(property(module.arguments[0], "imports")),
            controllers: values(property(module.arguments[0], "controllers")),
            dynamic: node.members.some((m) => m.name?.getText(ast) === "register"),
            ...location(node),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  pkg.sourceDependencies = [...imports].filter((n) => n !== pkg.name).sort();
}

const tasks = files(path.join(root, "specs"))
  .filter((f) => path.basename(f) === "tasks.md")
  .map((file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    return {
      feature: path.basename(path.dirname(file)),
      total: lines.filter((l) => /^- \[[ xX]\]/.test(l)).length,
      complete: lines.filter((l) => /^- \[[xX]\]/.test(l)).length,
      open: lines.flatMap((l, i) =>
        /^- \[ \]/.test(l) ? [{ text: l.slice(6), path: rel(file), line: i + 1 }] : [],
      ),
    };
  });
const sourceDigest = crypto
  .createHash("sha256")
  .update(
    sourceHashes
      .map((v) => `${v.path}:${v.sha256}`)
      .sort()
      .join("\n"),
  )
  .digest("hex");
const data = {
  generatedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  basis:
    "Current working tree; declarations, not proof of runtime route registration or live infrastructure.",
  sourceDigest,
  packages,
  tables,
  controllers,
  modules,
  tasks,
  sourceHashes,
};
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify(data, null, 2) + "\n");
const link = ({ path: p, line }) => `[${p}:${line}](../../${p}#L${line})`;
const md = [
  "# Технический каталог архитектуры",
  "",
  `Снимок: ${data.generatedAt}. HEAD: \`${data.commit.slice(0, 7)}\` + рабочие изменения.`,
  "",
  "Автоматический разбор TypeScript AST. Декларация контроллера не означает его подключение в каждом runtime profile. Список таблиц отражает EntitySchema в исходниках, а не запрос к развёрнутой БД; таблицы, создаваемые только SQL-миграциями, сюда не входят. Source imports включают type-only imports и re-exports.",
  "",
  "[Основная схема](README.md)",
  "",
  "## Пакеты и зависимости",
  "",
  "| Пакет | Исходники | Импорты других пакетов |",
  "|---|---:|---|",
  ...packages.map(
    (p) =>
      `| [${p.name}](../../${p.path}/package.json) | ${p.sourceFiles} | ${p.sourceDependencies.map((x) => "`" + x + "`").join(", ") || "—"} |`,
  ),
  "",
  "## Модули NestJS",
  "",
  "| Модуль | Контроллеры в статическом декораторе | Импорты / dynamic | Источник |",
  "|---|---|---|---|",
  ...modules.map(
    (m) =>
      `| ${m.name} | ${m.controllers.join(", ") || "—"} | ${m.imports.join(", ") || "—"}${m.dynamic ? "; register() — состав см. в коде" : ""} | ${link(m)} |`,
  ),
  "",
  "## Таблицы EntitySchema",
  "",
  `Найдено ${tables.length} деклараций. Ownership — пакет с декларацией; один PostgreSQL, логические владельцы и префиксы таблиц.`,
  "",
];
for (const pkg of packages) {
  const owned = tables
    .filter((t) => t.owner === pkg.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!owned.length) continue;
  md.push(
    `### ${pkg.name}`,
    "",
    "| Таблица | Entity | Источник |",
    "|---|---|---|",
    ...owned.map((t) => `| \`${t.name}\` | ${t.entity ?? "—"} | ${link(t)} |`),
    "",
  );
}
md.push(
  "## Объявленные HTTP-маршруты",
  "",
  "Это каталог исходного кода. Локальные fixtures, reusable controllers и корпоративные routes указаны вместе, но не являются одним подключённым API. Рабочие поверхности показаны в основной схеме.",
  "",
);
for (const c of controllers.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)) {
  md.push(
    `### ${c.name}`,
    "",
    `${c.owner} · ${link(c)}${c.guards.length ? " · class guard: `" + c.guards.join(", ") + "`" : ""}`,
    "",
    "| Метод | Путь | Handler |",
    "|---|---|---|",
    ...c.methods.map((m) => `| ${m.verb} | \`${m.path}\` | \`${m.method}\` |`),
    "",
  );
}
md.push("## Незавершённые задачи в исходных tasks.md", "");
for (const feature of tasks)
  md.push(
    `- ${feature.feature}: ${feature.complete}/${feature.total}; открыто ${feature.open.length}.`,
    ...feature.open.map((t) => `  - ${t.text} — ${link(t)}`),
  );
md.push(
  "",
  "## Воспроизведение",
  "",
  "`node docs/architecture/generate-inventory.mjs` из корня репозитория обновляет этот каталог и inventory.json; основная архитектурная схема редактируется после анализа изменений.",
  "",
  `SHA-256 набора проанализированных исходников: \`${sourceDigest}\`.`,
  "",
);
fs.writeFileSync(path.join(out, "inventory.md"), md.join("\n"));
console.log(
  JSON.stringify(
    {
      packages: packages.length,
      sourceFiles: sourceHashes.length,
      entities: tables.length,
      controllers: controllers.length,
      routes: controllers.reduce((s, c) => s + c.methods.length, 0),
      modules: modules.length,
      tasks: tasks.map((t) => ({
        feature: t.feature,
        complete: t.complete,
        total: t.total,
        open: t.open.length,
      })),
      sourceDigest,
    },
    null,
    2,
  ),
);
