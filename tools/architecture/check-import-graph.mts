import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { packageToProject, projectRules } from "./dependency-rules.mts";

type ProjectName = keyof typeof projectRules;
const root = resolve(import.meta.dirname, "../..");
const sourceRoots = new Map<ProjectName, string>();
const projectRoots = new Map<ProjectName, string>();
for (const name of Object.keys(projectRules) as ProjectName[]) {
  const base = projectRules[name].layer === "app" ? "apps" : "packages";
  const projectRoot = resolve(root, base, name);
  projectRoots.set(name, projectRoot);
  sourceRoots.set(name, resolve(projectRoot, "src"));
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: string | Readonly<Record<string, unknown>>;
}

const packageManifests = new Map<string, PackageManifest>();
const packageExportSubpaths = new Map<string, ReadonlySet<string>>();
for (const [packageName, project] of packageToProject) {
  const manifest = JSON.parse(
    await readFile(resolve(projectRoots.get(project)!, "package.json"), "utf8"),
  ) as PackageManifest;
  packageManifests.set(packageName, manifest);
  const exported =
    typeof manifest.exports === "string" ? ["."] : Object.keys(manifest.exports ?? {});
  packageExportSubpaths.set(packageName, new Set(exported));
}

async function filesBelow(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? filesBelow(path)
          : /\.(?:ts|tsx|mts)$/u.test(entry.name)
            ? [path]
            : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)(["'])([^"']+)\1/gu;
const graph = new Map<ProjectName, Set<ProjectName>>();
const violations: string[] = [];

function workspaceSpecifier(
  specifier: string,
): Readonly<{ packageName: string; subpath: string; project?: ProjectName }> {
  const packageName = specifier.split("/").slice(0, 2).join("/");
  const suffix = specifier.slice(packageName.length);
  return {
    packageName,
    subpath: suffix.length === 0 ? "." : `.${suffix}`,
    ...(packageToProject.has(packageName) ? { project: packageToProject.get(packageName)! } : {}),
  };
}

function externalPackageName(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/", 1)[0]!;
}

for (const [project, directory] of sourceRoots) {
  const dependencies = new Set<ProjectName>();
  for (const file of await filesBelow(directory)) {
    const source = await readFile(file, "utf8");
    if (/\beval\s*\(|\bnew\s+Function\s*\(|import\s*\(\s*[`$]/u.test(source))
      violations.push(`${file}: runtime code loading is forbidden`);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2];
      if (specifier === undefined || specifier.startsWith(".") || specifier.startsWith("node:"))
        continue;
      if (!specifier.startsWith("@awp/")) {
        if (project === "competency-qa") {
          const owner = externalPackageName(specifier);
          const manifest = packageManifests.get("@awp/competency-qa");
          const declared = {
            ...(manifest?.dependencies ?? {}),
            ...(manifest?.devDependencies ?? {}),
          };
          if (!(owner in declared))
            violations.push(
              `${file}: QA package imports undeclared vendor dependency ${specifier}`,
            );
        }
        continue;
      }
      const workspaceImport = workspaceSpecifier(specifier);
      const target = workspaceImport.project;
      if (target === undefined) {
        violations.push(`${file}: unknown workspace import ${specifier}`);
        continue;
      }
      if (!packageExportSubpaths.get(workspaceImport.packageName)?.has(workspaceImport.subpath)) {
        violations.push(`${file}: undeclared package export ${specifier}`);
      }
      if (project === "web" && specifier === "@awp/competency-qa/node")
        violations.push(`${file}: Web cannot import @awp/competency-qa/node`);
      if (
        project === "competency-qa" &&
        (target === "platform-core" ||
          target === "platform-runtime-nest" ||
          target === "connector-sdk" ||
          target === "connector-mock")
      ) {
        violations.push(`${file}: QA package cannot depend on ${workspaceImport.packageName}`);
      }
      if (target !== undefined && target !== project) dependencies.add(target);
    }
  }
  graph.set(project, dependencies);
  for (const target of dependencies) {
    const sourceRule = projectRules[project];
    const targetLayer = projectRules[target].layer;
    if (!(sourceRule.allow as readonly string[]).includes(targetLayer)) {
      violations.push(
        `${project} (${sourceRule.layer}) cannot depend on ${target} (${targetLayer})`,
      );
    }
  }
}

function visit(node: ProjectName, trail: ProjectName[]): void {
  if (trail.includes(node)) {
    violations.push(
      `dependency cycle: ${[...trail.slice(trail.indexOf(node)), node].join(" -> ")}`,
    );
    return;
  }
  for (const next of graph.get(node) ?? []) visit(next, [...trail, node]);
}
for (const node of graph.keys()) visit(node, []);

if (process.argv.includes("--core-only")) {
  for (const dependency of graph.get("platform-core") ?? []) {
    if (!new Set<ProjectName>(["platform-contracts"]).has(dependency))
      violations.push(`Core-only build includes ${dependency}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture graph accepted (${graph.size} projects; no deep imports, cycles, or dynamic loading).`,
  );
}
