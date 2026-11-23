import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { parse } from "yaml";

type JsonObject = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../..");
const contractRoot = resolve(root, "specs/001-extension-kernel-local-skeleton/contracts");
const qaContractRoot = resolve(root, "specs/002-qa-manual-walking-skeleton/contracts");
const jiraContractRoot = resolve(root, "specs/003-jira-operational-authority/contracts");
const mattermostContractRoot = resolve(root, "specs/004-mattermost-hermes-intake/contracts");
const gitLabContractRoot = resolve(root, "specs/005-gitlab-automated-validation/contracts");
const queueContractRoot = resolve(root, "specs/006-queue-triage-capacity-sla/contracts");
const onboardingContractRoot = resolve(
  root,
  "specs/007-project-onboarding-evidence-security/contracts",
);
const projectDialoguePath = resolve(
  root,
  "specs/023-hermes-customer-projects/contracts/project-dialogues.v1.yaml",
);
const schemaRoots = [
  resolve(contractRoot, "schemas"),
  resolve(qaContractRoot, "schemas"),
  resolve(jiraContractRoot, "schemas"),
  resolve(mattermostContractRoot, "schemas"),
  resolve(gitLabContractRoot, "schemas"),
  resolve(queueContractRoot, "schemas"),
  resolve(onboardingContractRoot, "schemas"),
];
const corePath = resolve(contractRoot, "openapi/core-api.v1.yaml");
const dummyPath = resolve(contractRoot, "openapi/dummy-pack-api.v1.yaml");
const mockPath = resolve(contractRoot, "openapi/mock-hub-api.v1.yaml");
const qaPath = resolve(qaContractRoot, "openapi/qa-pack-api.v1.yaml");
const operationalMockPath = resolve(qaContractRoot, "openapi/mock-hub-operational-api.v1.yaml");
const jiraPath = resolve(jiraContractRoot, "openapi/jira-operational-authority-api.v1.yaml");
const mattermostPath = resolve(
  mattermostContractRoot,
  "openapi/mattermost-hermes-intake-api.v1.yaml",
);
const gitLabPath = resolve(gitLabContractRoot, "openapi/gitlab-automated-validation-api.v1.yaml");
const queuePath = resolve(queueContractRoot, "openapi/queue-triage-capacity-sla-api.v1.yaml");
const approvalV11Path = resolve(queueContractRoot, "openapi/core-approval-api.v1.1.yaml");
const onboardingV11Path = resolve(
  onboardingContractRoot,
  "openapi/project-onboarding-api.v1.1.yaml",
);
const projectReadsPath = resolve(onboardingContractRoot, "openapi/project-reads-api.v1.yaml");
const onboardingPath = resolve(
  onboardingContractRoot,
  "openapi/project-onboarding-evidence-api.v1.yaml",
);

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : entry.name.endsWith(".json") ? [path] : [];
      }),
    )
  )
    .flat()
    .sort();
}

const schemaFiles = (await Promise.all(schemaRoots.map(filesBelow))).flat().sort();
const schemas = new Map<string, JsonObject>();
const componentByPath = new Map<string, string>();
const componentById = new Map<string, string>();
for (const path of schemaFiles) {
  const schema = JSON.parse(await readFile(path, "utf8")) as JsonObject;
  const id = String(schema.$id ?? "");
  if (!id.startsWith("urn:awp:")) throw new Error(`${path}: immutable schema id required`);
  const component = id.replace(/^urn:awp:/u, "awp_").replace(/[^A-Za-z0-9_]/gu, "_");
  schemas.set(path, schema);
  componentByPath.set(path, component);
  componentById.set(id, component);
}

function rewrite(value: unknown, sourcePath: string, embeddedSchema: boolean): unknown {
  if (Array.isArray(value)) return value.map((child) => rewrite(child, sourcePath, embeddedSchema));
  if (value === null || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key !== "$ref" || typeof child !== "string") {
      output[key] = rewrite(child, sourcePath, embeddedSchema);
      continue;
    }
    if (child.startsWith("#")) {
      output[key] = embeddedSchema
        ? `#/components/schemas/${componentByPath.get(sourcePath)}${child.slice(1)}`
        : child;
      continue;
    }
    if (child.startsWith("urn:awp:")) {
      const [id, fragment = ""] = child.split("#", 2);
      const component = componentById.get(id!);
      if (!component) throw new Error(`${sourcePath}: unresolved schema id ${child}`);
      output[key] =
        `#/components/schemas/${component}${fragment ? `/${fragment.replace(/^\//u, "")}` : ""}`;
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/iu.test(child))
      throw new Error(`${sourcePath}: remote OpenAPI ref forbidden: ${child}`);
    const [pathPart, fragment = ""] = child.split("#", 2);
    const targetPath = resolve(dirname(sourcePath), pathPart!);
    const component = componentByPath.get(targetPath);
    if (component) {
      output[key] =
        `#/components/schemas/${component}${fragment ? `/${fragment.replace(/^\//u, "")}` : ""}`;
      continue;
    }
    if (
      new Set([
        corePath,
        dummyPath,
        mockPath,
        qaPath,
        operationalMockPath,
        jiraPath,
        mattermostPath,
        gitLabPath,
        queuePath,
        approvalV11Path,
        onboardingPath,
        onboardingV11Path,
        projectReadsPath,
      ]).has(targetPath) &&
      fragment.startsWith("/")
    ) {
      output[key] = `#${fragment}`;
      continue;
    }
    throw new Error(`${sourcePath}: unresolved OpenAPI ref ${child}`);
  }
  return output;
}

function record(value: unknown): JsonObject {
  return value as JsonObject;
}
function mergeComponents(left: JsonObject | undefined, right: JsonObject | undefined): JsonObject {
  const output: JsonObject = { ...(left ?? {}) };
  for (const [section, value] of Object.entries(right ?? {}))
    output[section] = { ...record(output[section] ?? {}), ...record(value) };
  return output;
}

function mergeManyComponents(...components: readonly (JsonObject | undefined)[]): JsonObject {
  return components.reduce<JsonObject>(
    (merged, component) => mergeComponents(merged, component),
    {},
  );
}

function namespaceOpenApiComponents(document: JsonObject, prefix: string): JsonObject {
  const components = record(document.components ?? {});
  const names = new Map<string, Map<string, string>>();
  for (const [section, rawEntries] of Object.entries(components)) {
    if (!rawEntries || typeof rawEntries !== "object" || Array.isArray(rawEntries)) continue;
    names.set(
      section,
      new Map(Object.keys(record(rawEntries)).map((name) => [name, `${prefix}${name}`])),
    );
  }
  function visit(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) {
      if (key === "security") {
        const securityNames = names.get("securitySchemes") ?? new Map<string, string>();
        return value.map((requirement) =>
          Object.fromEntries(
            Object.entries(record(requirement)).map(([name, scopes]) => [
              securityNames.get(name) ?? name,
              visit(scopes),
            ]),
          ),
        );
      }
      return value.map((child) => visit(child));
    }
    if (value === null || typeof value !== "object") return value;
    const output: JsonObject = {};
    for (const [childKey, child] of Object.entries(record(value))) {
      if (childKey === "$ref" && typeof child === "string") {
        const match = child.match(/^#\/components\/([^/]+)\/([^/]+)(.*)$/u);
        const renamed = match ? names.get(match[1]!)?.get(match[2]!) : undefined;
        output[childKey] = renamed ? `#/components/${match![1]}/${renamed}${match![3]}` : child;
      } else output[childKey] = visit(child, childKey);
    }
    return output;
  }
  const output = visit(document) as JsonObject;
  const outputComponents = record(output.components ?? {});
  for (const [section, sectionNames] of names) {
    const entries = record(outputComponents[section] ?? {});
    outputComponents[section] = Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [sectionNames.get(name) ?? name, value]),
    );
  }
  output.components = outputComponents;
  return output;
}

const [
  coreText,
  dummyText,
  mockText,
  qaText,
  operationalMockText,
  jiraText,
  mattermostText,
  gitLabText,
  queueText,
  approvalV11Text,
  onboardingText,
  onboardingV11Text,
  projectReadsText,
] = await Promise.all([
  readFile(corePath, "utf8"),
  readFile(dummyPath, "utf8"),
  readFile(mockPath, "utf8"),
  readFile(qaPath, "utf8"),
  readFile(operationalMockPath, "utf8"),
  readFile(jiraPath, "utf8"),
  readFile(mattermostPath, "utf8"),
  readFile(gitLabPath, "utf8"),
  readFile(queuePath, "utf8"),
  readFile(approvalV11Path, "utf8"),
  readFile(onboardingPath, "utf8"),
  readFile(onboardingV11Path, "utf8"),
  readFile(projectReadsPath, "utf8"),
]);
const core = parse(coreText) as JsonObject;
const dummy = parse(dummyText) as JsonObject;
const mock = parse(mockText) as JsonObject;
const qa = parse(qaText) as JsonObject;
const operationalMock = parse(operationalMockText) as JsonObject;
const jira = parse(jiraText) as JsonObject;
const mattermost = parse(mattermostText) as JsonObject;
const gitLab = parse(gitLabText) as JsonObject;
const queue = parse(queueText) as JsonObject;
const approvalV11 = parse(approvalV11Text) as JsonObject;
const onboardingV11 = parse(onboardingV11Text) as JsonObject;
const onboarding = parse(onboardingText) as JsonObject;
const qaRewritten = rewrite(qa, qaPath, false) as JsonObject;
const operationalMockRewritten = rewrite(operationalMock, operationalMockPath, false) as JsonObject;
const jiraRewritten = rewrite(jira, jiraPath, false) as JsonObject;
const mattermostRewritten = rewrite(mattermost, mattermostPath, false) as JsonObject;
const gitLabRewritten = rewrite(gitLab, gitLabPath, false) as JsonObject;
const queueRewritten = namespaceOpenApiComponents(
  rewrite(queue, queuePath, false) as JsonObject,
  "Feature006Queue_",
);
const approvalV11Rewritten = namespaceOpenApiComponents(
  rewrite(approvalV11, approvalV11Path, false) as JsonObject,
  "Feature006ApprovalV11_",
);
const onboardingRewritten = namespaceOpenApiComponents(
  rewrite(onboarding, onboardingPath, false) as JsonObject,
  "Feature007Onboarding_",
);
const onboardingV11Rewritten = namespaceOpenApiComponents(
  rewrite(onboardingV11, onboardingV11Path, false) as JsonObject,
  "Feature007OnboardingV11_",
);
const projectReadsRewritten = namespaceOpenApiComponents(
  rewrite(parse(projectReadsText) as JsonObject, projectReadsPath, false) as JsonObject,
  "Feature007ProjectReads_",
);
const embeddedSchemas = Object.fromEntries(
  schemaFiles.map((path) => [componentByPath.get(path)!, rewrite(schemas.get(path), path, true)]),
);
const projectDialogueDocument = namespaceOpenApiComponents(
  parse(await readFile(projectDialoguePath, "utf8")) as JsonObject,
  "Feature023_",
);
const sourceFiles = [
  projectDialoguePath,
  corePath,
  dummyPath,
  mockPath,
  qaPath,
  operationalMockPath,
  jiraPath,
  mattermostPath,
  gitLabPath,
  queuePath,
  approvalV11Path,
  onboardingPath,
  onboardingV11Path,
  projectReadsPath,
  ...schemaFiles,
];
const sourceDigests = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      relative(root, path),
      `sha256:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`,
    ]),
  ),
);

function standalone(document: JsonObject, sourcePath: string): JsonObject {
  const rewritten = rewrite(document, sourcePath, false) as JsonObject;
  const components = record(rewritten.components ?? {});
  rewritten.components = {
    ...components,
    schemas: { ...record(components.schemas ?? {}), ...embeddedSchemas },
  };
  rewritten["x-awp-source-digests"] = sourceDigests;
  return rewritten;
}

const api = structuredClone(core);
const qaImplementedOperationIds = new Set([
  "confirmQaIntakeDraft",
  "getQaRequestExtension",
  "getQaWorkItemDetailHistory",
  "getQaRequestInputHistory",
  "getCurrentQaRequestInputRevision",
  "listConfirmedQaBacklog",
  "getConfirmedQaBacklogItem",
  "reviseQaRequestInputs",
  "evaluateQaReadiness",
  "confirmQaReadiness",
  "requestQaWaiver",
  "getRequiredSessionPlanHistory",
  "publishRequiredSessionPlanRevision",
  "getCurrentRequiredSessionPlanRevision",
  "getRequiredSessionPlanRevision",
  "listQaSessions",
  "createQaSession",
  "getQaSession",
  "transitionQaSession",
  "listQaPlanItems",
  "createQaPlanItem",
  "getQaPlanItem",
  "updateQaPlanItemBeforeSessionStart",
  "listManualAttempts",
  "startManualAttempt",
  "completeManualAttempt",
  "listQaObservationsForAttempt",
  "recordQaObservation",
  "listQaPlanItemResultRevisions",
  "recordQaPlanItemResultRevision",
  "listQaEvidenceArtifactLinks",
  "getQaEvidenceArtifactLink",
  "listQaEvidenceManifests",
  "reviewQaSessionAndPublishEvidence",
  "getQaEvidenceManifestHistory",
  "getQaEvidenceManifestRevision",
  "createQaVerdict",
  "supersedeQaVerdictBeforeDone",
  "signQaVerdict",
  "evaluateQaDefinitionOfDone",
  "createQaCompletionCandidate",
  "getQaCompletionCandidate",
  "getQaFinalCloseConfirmation",
  "requestQaFinalClose",
  "createQaPostCloseManifestRevision",
]);
function selectOperations(document: JsonObject, selected: ReadonlySet<string>): JsonObject {
  const paths: JsonObject = {};
  for (const [path, rawPathItem] of Object.entries(record(document.paths))) {
    const pathItem = record(rawPathItem);
    const output: JsonObject = {};
    if (pathItem.parameters) output.parameters = pathItem.parameters;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (method === "parameters") continue;
      if (selected.has(String(record(operation).operationId))) output[method] = operation;
    }
    if (Object.keys(output).some((key) => key !== "parameters")) paths[path] = output;
  }
  return paths;
}
const qaImplementedPaths = selectOperations(qaRewritten, qaImplementedOperationIds);
api.info = {
  title:
    "Agentic Workspace Platform Core + Dummy + QA + Jira + Mattermost/Hermes + GitLab Automation + Queue + Project Onboarding API",
  version: "1.0.0",
};
api.paths = {
  ...record(projectDialogueDocument.paths),
  ...record(core.paths),
  ...record(dummy.paths),
  ...qaImplementedPaths,
  ...record(jiraRewritten.paths),
  ...record(mattermostRewritten.paths),
  ...record(gitLabRewritten.paths),
  ...record(queueRewritten.paths),
  ...record(approvalV11Rewritten.paths),
  ...record(onboardingRewritten.paths),
  ...record(onboardingV11Rewritten.paths),
  ...record(projectReadsRewritten.paths),
};
api.components = mergeManyComponents(
  record(projectDialogueDocument.components),
  record(core.components),
  record(dummy.components),
  record(qaRewritten.components),
  record(jiraRewritten.components),
  record(mattermostRewritten.components),
  record(gitLabRewritten.components),
  record(queueRewritten.components),
  record(approvalV11Rewritten.components),
  record(onboardingRewritten.components),
  record(onboardingV11Rewritten.components),
  record(projectReadsRewritten.components),
);
const apiDocument = standalone(api, corePath);
const mockImplemented = structuredClone(mock);
mockImplemented.info = { title: "Mock Hub Core + Operational Work Item API", version: "1.0.0" };
mockImplemented.paths = { ...record(mock.paths), ...record(operationalMockRewritten.paths) };
mockImplemented.paths = {
  ...record(mockImplemented.paths),
  "/api/v4/system/ping": {
    get: {
      operationId: "pingMockMattermost",
      responses: { "200": { description: "Mock Mattermost ping" } },
    },
  },
  "/api/v4/posts": {
    get: {
      operationId: "lookupMockMattermostPostByEffect",
      responses: { "200": { description: "Safe effect lookup" } },
    },
    post: {
      operationId: "createMockMattermostPost",
      responses: { "201": { description: "Created once" } },
    },
  },
  "/mock/mattermost/state": {
    get: {
      operationId: "getMockMattermostState",
      responses: { "200": { description: "Deterministic state" } },
    },
  },
  "/mock/mattermost/fault": {
    post: {
      operationId: "setMockMattermostFault",
      responses: { "201": { description: "Fault selected" } },
    },
  },
  "/mock/mattermost/callbacks": {
    post: {
      operationId: "recordMockMattermostCallback",
      responses: { "201": { description: "Callback recorded" } },
    },
  },
};
mockImplemented.components = mergeComponents(
  record(mock.components),
  record(operationalMockRewritten.components),
);
const mockDocument = standalone(mockImplemented, mockPath);
const outputs = [
  [resolve(root, "apps/api/openapi.generated.json"), apiDocument],
  [resolve(root, "apps/mock-hub/openapi.generated.json"), mockDocument],
] as const;

for (const [path, document] of outputs) {
  const generated = `${JSON.stringify(document, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8").catch(() => "")) !== generated)
      throw new Error(`${relative(root, path)} is stale; run pnpm contracts:openapi`);
  } else await writeFile(path, generated, "utf8");
}
console.log(
  `OpenAPI snapshots ${process.argv.includes("--check") ? "verified" : "generated"}: Core+Dummy+QA+Jira+Mattermost/Hermes+GitLab Automation+Queue/Approval 1.1+Project Onboarding and Mock Hub slices.`,
);
