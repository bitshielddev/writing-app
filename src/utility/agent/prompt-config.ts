import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { parse } from "yaml";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const strict = { additionalProperties: false } as const;
const CONFIG_MAX_BYTES = 16 * 1024;
const PROMPT_FILE_MAX_BYTES = 100 * 1024;
const KNOWN_REVIEW_PLACEHOLDERS = new Set([
  "project_revision",
  "document_revision",
]);

const AgentPromptConfigSchema = Type.Object({
  schema_version: Type.Literal(1),
  prompt_file: Type.String({ minLength: 1, maxLength: 4_096 }),
}, strict);

const AgentPromptFileSchema = Type.Object({
  schema_version: Type.Literal(1),
  system_append: Type.String({ minLength: 1, maxLength: PROMPT_FILE_MAX_BYTES }),
  review_cycle: Type.String({ minLength: 1, maxLength: PROMPT_FILE_MAX_BYTES }),
}, strict);

const AgentPromptsSchema = Type.Object({
  systemAppend: Type.String({ minLength: 1, maxLength: PROMPT_FILE_MAX_BYTES }),
  reviewCycle: Type.String({ minLength: 1, maxLength: PROMPT_FILE_MAX_BYTES }),
  promptFile: Type.String({ minLength: 1, maxLength: 4_096 }),
}, strict);

const AgentPromptBootstrapSchema = Type.Union([
  Type.Object({
    schemaVersion: Type.Literal(1),
    status: Type.Literal("ready"),
    prompts: AgentPromptsSchema,
  }, strict),
  Type.Object({
    schemaVersion: Type.Literal(1),
    status: Type.Literal("error"),
    error: Type.String({ minLength: 1, maxLength: 20_000 }),
  }, strict),
]);

type AgentPromptConfig = Static<typeof AgentPromptConfigSchema>;
type AgentPromptFile = Static<typeof AgentPromptFileSchema>;
export type AgentPrompts = Static<typeof AgentPromptsSchema>;
type AgentPromptBootstrap = Static<typeof AgentPromptBootstrapSchema>;

function validationFailure(
  subject: string,
  errors: Iterable<{ path?: string; message?: string }>,
) {
  const first = [...errors][0];
  throw new Error(
    `${subject} is invalid at ${first?.path || "root"}: ${first?.message ?? "schema mismatch"}`,
  );
}

async function readBoundedFile(path: string, subject: string, maximumBytes: number) {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    throw new Error(
      `${subject} could not be read at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!fileStat.isFile()) throw new Error(`${subject} is not a file: ${path}`);
  if (fileStat.size > maximumBytes) {
    throw new Error(`${subject} exceeds the ${maximumBytes}-byte limit: ${path}`);
  }
  return readFile(path, "utf8");
}

async function readYaml<T>(
  path: string,
  subject: string,
  maximumBytes: number,
  schema: typeof AgentPromptConfigSchema | typeof AgentPromptFileSchema,
): Promise<T> {
  const source = await readBoundedFile(path, subject, maximumBytes);
  let document: unknown;
  try {
    document = parse(source, { uniqueKeys: true });
  } catch (error) {
    throw new Error(
      `${subject} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Value.Check(schema, document)) {
    validationFailure(subject, Value.Errors(schema, document));
  }
  return document as T;
}

function assertReviewPlaceholders(source: string) {
  const placeholderPattern = /{{([^{}]+)}}/g;
  for (const match of source.matchAll(placeholderPattern)) {
    const name = match[1];
    if (!KNOWN_REVIEW_PLACEHOLDERS.has(name)) {
      throw new Error(`review_cycle contains unknown placeholder: {{${name}}}`);
    }
  }
  const withoutKnownPlaceholders = source.replace(
    /{{(?:project_revision|document_revision)}}/g,
    "",
  );
  if (withoutKnownPlaceholders.includes("{{") || withoutKnownPlaceholders.includes("}}")) {
    throw new Error("review_cycle contains a malformed placeholder");
  }
}

async function confinedPromptPath(experienceDirectory: string, configuredPath: string) {
  const root = await realpath(experienceDirectory);
  const candidate = resolve(root, configuredPath);
  const resolvedCandidate = await realpath(candidate).catch((error: unknown) => {
    throw new Error(
      `Selected prompt file could not be resolved at ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  const pathFromRoot = relative(root, resolvedCandidate);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("prompt_file must stay inside the experience directory");
  }
  return resolvedCandidate;
}

export async function loadAgentPromptConfiguration(
  experienceDirectory: string,
): Promise<AgentPrompts> {
  const configPath = join(experienceDirectory, "config.yaml");
  const config = await readYaml<AgentPromptConfig>(
    configPath,
    "experience/config.yaml",
    CONFIG_MAX_BYTES,
    AgentPromptConfigSchema,
  );
  const promptPath = await confinedPromptPath(experienceDirectory, config.prompt_file);
  const promptFile = await readYaml<AgentPromptFile>(
    promptPath,
    `Agent prompt file ${config.prompt_file}`,
    PROMPT_FILE_MAX_BYTES,
    AgentPromptFileSchema,
  );
  if (promptFile.system_append.includes("{{") || promptFile.system_append.includes("}}")) {
    throw new Error("system_append does not support placeholders");
  }
  assertReviewPlaceholders(promptFile.review_cycle);
  return {
    systemAppend: promptFile.system_append,
    reviewCycle: promptFile.review_cycle,
    promptFile: config.prompt_file,
  };
}

export function renderReviewCyclePrompt(
  template: string,
  revisions: { projectRevision: number; documentRevision: number },
) {
  return template
    .replaceAll("{{project_revision}}", String(revisions.projectRevision))
    .replaceAll("{{document_revision}}", String(revisions.documentRevision));
}

async function atomicWrite(path: string, contents: string) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function writeAgentPromptBootstrap(
  experienceDirectory: string,
  snapshotPath: string,
) {
  let bootstrap: AgentPromptBootstrap;
  try {
    bootstrap = {
      schemaVersion: 1,
      status: "ready",
      prompts: await loadAgentPromptConfiguration(experienceDirectory),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bootstrap = {
      schemaVersion: 1,
      status: "error",
      error: message.slice(0, 20_000) || "Unknown agent prompt configuration error",
    };
  }
  await atomicWrite(snapshotPath, `${JSON.stringify(bootstrap)}\n`);
}

export async function loadAgentPromptBootstrap(snapshotPath: string): Promise<AgentPrompts> {
  const source = await readBoundedFile(
    snapshotPath,
    "Agent prompt launch snapshot",
    PROMPT_FILE_MAX_BYTES * 2,
  );
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Agent prompt launch snapshot is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Value.Check(AgentPromptBootstrapSchema, document)) {
    validationFailure(
      "Agent prompt launch snapshot",
      Value.Errors(AgentPromptBootstrapSchema, document),
    );
  }
  const bootstrap = document as AgentPromptBootstrap;
  if (bootstrap.status === "error") {
    throw new Error(`Agent prompt configuration is invalid: ${bootstrap.error}`);
  }
  return bootstrap.prompts;
}
