import { randomUUID } from "node:crypto";

import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

import type {
  ObservationSeed,
  ProjectContentItem,
  ProviderSettings,
} from "../src/shared/desktop.js";
import type { SuggestionItem, SuggestionKind } from "../src/suggestions/types.js";

type ParentMessage =
  | { kind: "configure"; provider: ProviderSettings; apiKey: string }
  | { kind: "observe"; seed: ObservationSeed; apiKey: string; force: boolean }
  | { kind: "abort" }
  | { kind: "resume" }
  | { kind: "storage.result"; id: string; result?: unknown; error?: string };

type ObservationRequest = Extract<ParentMessage, { kind: "observe" }>;

const pendingStorage = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let providerSettings: ProviderSettings = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  baseUrl: "",
  enabled: false,
};
let configuredApiKey = "";
let activeAgent: Agent | undefined;
let running = false;
let paused = false;
let queued: ObservationRequest | undefined;
let lastCompletedRevision = -1;

function storageCall<T>(method: string, params?: unknown): Promise<T> {
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    pendingStorage.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    process.parentPort?.postMessage({
      kind: "storage.request",
      id,
      method,
      params,
    });
  });
}

function runtime(update: Record<string, unknown>) {
  process.parentPort?.postMessage({ kind: "agent.runtime", runtime: update });
}

const suggestionSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("snippet"),
    Type.Literal("fact"),
    Type.Literal("term"),
    Type.Literal("outline"),
    Type.Literal("layout"),
    Type.Literal("mindMap"),
  ]),
  dedupeKey: Type.String({ minLength: 1, maxLength: 200 }),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  summary: Type.String({ minLength: 1, maxLength: 1_000 }),
  body: Type.String({ minLength: 1, maxLength: 8_000 }),
  sourceLabels: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 12 }),
  insertText: Type.Optional(Type.String({ maxLength: 20_000 })),
  nodes: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 100 })),
  mermaidSource: Type.Optional(Type.String({ maxLength: 20_000 })),
  accessibleDescription: Type.Optional(Type.String({ maxLength: 4_000 })),
});

type SuggestionInput = {
  kind: SuggestionKind;
  dedupeKey: string;
  title: string;
  summary: string;
  body: string;
  sourceLabels: string[];
  insertText?: string;
  nodes?: unknown[];
  mermaidSource?: string;
  accessibleDescription?: string;
};

function toSuggestion(
  input: SuggestionInput,
  id: string = randomUUID(),
): SuggestionItem {
  const base = {
    id,
    dedupeKey: input.dedupeKey,
    title: input.title,
    summary: input.summary,
    body: input.body,
    sourceLabels: input.sourceLabels,
    createdAt: Date.now(),
  };
  if (input.kind === "snippet" || input.kind === "fact" || input.kind === "term") {
    if (!input.insertText) throw new Error("Text suggestions require insertText");
    return { ...base, kind: input.kind, insertText: input.insertText };
  }
  if (input.kind === "outline" || input.kind === "layout") {
    if (!input.nodes) throw new Error("Structure suggestions require nodes");
    return { ...base, kind: input.kind, nodes: input.nodes as never[] };
  }
  if (!input.mermaidSource || !input.accessibleDescription) {
    throw new Error("Mind maps require Mermaid source and an accessible description");
  }
  return {
    ...base,
    kind: "mindMap",
    mermaidSource: input.mermaidSource,
    accessibleDescription: input.accessibleDescription,
  };
}

function createTools(seed: ObservationSeed): AgentTool[] {
  const list: AgentTool = {
    name: "list_project_content",
    label: "List project content",
    description: "List the documents and imported sources available in the current project.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: JSON.stringify(await storageCall("agent.content.list")) }],
      details: {},
    }),
  };
  const read: AgentTool = {
    name: "read_project_content",
    label: "Read project content",
    description: "Read one project document or source by the stable ID returned by list_project_content.",
    parameters: Type.Object({
      id: Type.String(),
      type: Type.Union([Type.Literal("document"), Type.Literal("source")]),
    }),
    execute: async (_id, params) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await storageCall("agent.content.read", params)),
        },
      ],
      details: {},
    }),
  };
  const search: AgentTool = {
    name: "search_project_content",
    label: "Search project content",
    description: "Search all documents and imported source text in the current project.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }) }),
    execute: async (_id, params) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await storageCall("agent.content.search", params)),
        },
      ],
      details: {},
    }),
  };
  const listSuggestions: AgentTool = {
    name: "list_suggestions",
    label: "List suggestions",
    description: "List existing live, pinned, and workspace suggestions for this project.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await storageCall("agent.suggestions.list")),
        },
      ],
      details: {},
    }),
  };
  const create: AgentTool<typeof suggestionSchema> = {
    name: "create_suggestion",
    label: "Create suggestion",
    description: "Create a useful suggestion for the active document. This does not edit the document.",
    parameters: suggestionSchema,
    execute: async (_id, params) => {
      const item = toSuggestion(params as SuggestionInput);
      const result = await storageCall("agent.suggestion.create", {
        item,
        expectedDocumentRevision: seed.documentRevision,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: { item } };
    },
  };
  const update: AgentTool = {
    name: "update_suggestion",
    label: "Update suggestion",
    description: "Refine an existing live suggestion by ID.",
    parameters: Type.Intersect([
      suggestionSchema,
      Type.Object({ id: Type.String({ minLength: 1 }) }),
    ]),
    execute: async (_id, params) => {
      const input = params as SuggestionInput & { id: string };
      const item = toSuggestion(input, input.id);
      const result = await storageCall("agent.suggestion.update", {
        item,
        expectedDocumentRevision: seed.documentRevision,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: { item } };
    },
  };
  const retract: AgentTool = {
    name: "retract_suggestion",
    label: "Retract suggestion",
    description: "Retract an existing live suggestion by ID.",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }) }),
    execute: async (_id, params) => {
      const result = await storageCall("agent.suggestion.retract", {
        id: (params as { id: string }).id,
        expectedDocumentRevision: seed.documentRevision,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  };
  const memory: AgentTool = {
    name: "save_document_memory",
    label: "Save document memory",
    description: "Save a concise durable summary of the active document and useful project context for the next observation.",
    parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 8_000 }) }),
    execute: async (_id, params) => {
      await storageCall("agent.memory.save", {
        documentId: seed.documentId,
        documentRevision: seed.documentRevision,
        summary: (params as { summary: string }).summary,
      });
      return { content: [{ type: "text", text: "Memory saved." }], details: {} };
    },
  };
  return [list, read, search, listSuggestions, create, update, retract, memory];
}

function resolveModel(settings: ProviderSettings): Model<Api> {
  const lookup = getModel as unknown as (
    provider: string,
    model: string,
  ) => Model<Api> | undefined;
  const known = lookup(settings.provider, settings.model);
  if (!known) {
    if (!settings.baseUrl) {
      throw new Error(`Unknown model ${settings.provider}/${settings.model}`);
    }
    return {
      id: settings.model,
      name: settings.model,
      provider: settings.provider,
      api: settings.provider === "anthropic" ? "anthropic-messages" : "openai-completions",
      baseUrl: settings.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }
  return settings.baseUrl ? { ...known, baseUrl: settings.baseUrl } : known;
}

function serializable(event: AgentEvent) {
  try {
    return JSON.parse(JSON.stringify(event)) as unknown;
  } catch {
    return { type: event.type };
  }
}

async function perform(request: ObservationRequest) {
  const { seed } = request;
  const settings = seed.provider;
  const runId = randomUUID();
  running = true;
  runtime({ running: true, configured: true, lastError: undefined });
  try {
    const model = resolveModel(settings);
    await storageCall("agent.run.start", {
      id: runId,
      seed,
      provider: settings.provider,
      model: settings.model,
    });
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: "low",
        tools: createTools(seed),
        systemPrompt: `You are ScribeAI's background writing partner. Analyze the active document in the context of its project. Use project tools to read relevant material. Create only concrete, high-value suggestions; do not edit document content. Avoid duplicating existing suggestions. Before finishing, call save_document_memory with a concise summary for the next observation.\n\nPrevious document memory:\n${seed.memorySummary || "No previous memory."}`,
      },
      getApiKey: () => request.apiKey || configuredApiKey || undefined,
      toolExecution: "sequential",
    });
    activeAgent = agent;
    agent.subscribe(async (event) => {
      await storageCall("agent.run.transcript", {
        runId,
        eventType: event.type,
        payload: serializable(event),
      });
    });
    const timeout = setTimeout(() => agent.abort(), 120_000);
    try {
      const index = await storageCall<ProjectContentItem[]>("agent.content.list");
      await agent.prompt(
        `Observe project "${seed.projectName}" at project revision ${seed.projectRevision}. The active target is "${seed.documentTitle}" (document ID ${seed.documentId}, revision ${seed.documentRevision}). Project content index: ${JSON.stringify(index)}. Read the active document and any useful project sources, then manage suggestions.`,
      );
    } finally {
      clearTimeout(timeout);
    }
    await storageCall("agent.run.finish", { runId, status: "completed" });
    lastCompletedRevision = seed.projectRevision;
    process.parentPort?.postMessage({
      kind: "agent.complete",
      projectRevision: seed.projectRevision,
    });
    runtime({ running: false, lastCompletedAt: Date.now(), lastError: undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storageCall("agent.run.finish", {
      runId,
      status: "failed",
      error: message,
    }).catch(() => undefined);
    runtime({ running: false, lastError: message });
  } finally {
    activeAgent = undefined;
    running = false;
  }
}

async function drain(request: ObservationRequest) {
  if (paused) return;
  if (running) {
    queued = request;
    return;
  }
  if (!request.force && request.seed.projectRevision === lastCompletedRevision) return;
  await perform(request);
  const next = queued;
  queued = undefined;
  if (next && !paused && next.seed.projectRevision !== lastCompletedRevision) {
    await drain(next);
  }
}

process.parentPort?.on("message", ({ data }: { data: ParentMessage }) => {
  if (data.kind === "storage.result") {
    const request = pendingStorage.get(data.id);
    if (!request) return;
    pendingStorage.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
    return;
  }
  if (data.kind === "configure") {
    providerSettings = data.provider;
    configuredApiKey = data.apiKey;
    runtime({ configured: providerSettings.enabled });
    return;
  }
  if (data.kind === "abort") {
    paused = true;
    queued = undefined;
    activeAgent?.abort();
    return;
  }
  if (data.kind === "resume") {
    paused = false;
    return;
  }
  if (data.kind === "observe") {
    providerSettings = data.seed.provider;
    configuredApiKey = data.apiKey;
    void drain(data);
  }
});

process.parentPort?.postMessage({ kind: "ready" });
