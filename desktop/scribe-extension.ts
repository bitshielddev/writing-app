import { randomUUID } from "node:crypto";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ScribeLoopState, type PersistedScribeLoopState } from "./scribe-loop.js";
import type { AgentActivity } from "../src/shared/desktop.js";
import {
  isStructureSuggestionKind,
  isTextSuggestionKind,
  SUGGESTION_KINDS,
  type SuggestionItem,
  type SuggestionKind,
} from "../src/suggestions/types.js";

export const SCRIBE_LOOP_ENTRY = "scribe.loop-state";
export const SCRIBE_REVISION_EVENT = "scribe.project-revision";
export const SCRIBE_TOOL_NAMES = [
  "list_suggestions",
  "create_suggestion",
  "update_suggestion",
  "retract_suggestion",
  "wait_for_changes",
] as const;

export type ScribeRevision = {
  projectRevision: number;
  documentRevision: number;
};

export type ScribeExtensionHost = {
  loop: ScribeLoopState;
  storageCall<T>(method: string, params?: unknown): Promise<T>;
  runtime(): void;
  activity(input: Omit<AgentActivity, "updatedAt">): void;
  wake(): void;
  persist(): void;
};

const suggestionSchema = Type.Object({
  kind: Type.Union(SUGGESTION_KINDS.map((kind) => Type.Literal(kind))),
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

function toSuggestion(input: SuggestionInput, id: string = randomUUID()): SuggestionItem {
  const base = {
    id,
    dedupeKey: input.dedupeKey,
    title: input.title,
    summary: input.summary,
    body: input.body,
    sourceLabels: input.sourceLabels,
    createdAt: Date.now(),
  };
  if (isTextSuggestionKind(input.kind)) {
    if (!input.insertText) throw new Error("Text suggestions require insertText");
    return { ...base, kind: input.kind, insertText: input.insertText };
  }
  if (isStructureSuggestionKind(input.kind)) {
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

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
    details: value,
    isError,
  };
}

export async function executeSuggestionMutation(
  host: ScribeExtensionHost,
  method: string,
  params: Record<string, unknown>,
) {
  const expectedDocumentRevision = host.loop.snapshot().activeDocumentRevision;
  if (expectedDocumentRevision === undefined) {
    return toolResult("No active revision", true);
  }
  try {
    return toolResult(
      await host.storageCall(method, { ...params, expectedDocumentRevision }),
    );
  } catch (error) {
    host.wake();
    return toolResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

export function createScribeExtension(host: ScribeExtensionHost): ExtensionFactory {
  return (pi) => {
    host.persist = () => pi.appendEntry(SCRIBE_LOOP_ENTRY, host.loop.persisted());

    pi.on("session_start", (_event, ctx) => {
      const restored = ctx.sessionManager.getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === SCRIBE_LOOP_ENTRY)
        .at(-1) as { data?: PersistedScribeLoopState } | undefined;
      if (restored?.data) host.loop = new ScribeLoopState(restored.data);
      pi.setSessionName("Scribe writing partner");
    });

    pi.events.on(SCRIBE_REVISION_EVENT, (value) => {
      const revision = value as ScribeRevision;
      if (host.loop.revision(revision.projectRevision, revision.documentRevision)) {
        host.persist();
        host.runtime();
        host.activity({
          id: `loop:revision:${revision.projectRevision}`,
          kind: "loop",
          timestamp: Date.now(),
          title: "Project revision received",
          text: `Revision ${revision.projectRevision}`,
          payload: revision,
          status: "working",
        });
        host.wake();
      }
    });

    pi.on("before_provider_request", (event) => {
      host.activity({
        id: `provider:request:${Date.now()}`,
        kind: "provider",
        timestamp: Date.now(),
        title: "Provider request",
        payload: event.payload,
      });
    });
    pi.on("after_provider_response", (event) => {
      host.activity({
        id: `provider:response:${Date.now()}`,
        kind: "provider",
        timestamp: Date.now(),
        title: `Provider response ${event.status}`,
        payload: event,
      });
    });

    pi.registerTool({
      name: "list_suggestions",
      label: "List suggestions",
      description: "List current live, pinned, and workspace suggestions.",
      parameters: Type.Object({}),
      execute: async () => toolResult(await host.storageCall("agent.suggestions.list")),
    });
    pi.registerTool({
      name: "create_suggestion",
      label: "Create suggestion",
      description: "Publish a proposed draft change without editing draft.md.",
      parameters: suggestionSchema,
      execute: async (_id, params) => {
        const item = toSuggestion(params as SuggestionInput);
        return executeSuggestionMutation(
          host,
          "agent.suggestion.create",
          { item },
        );
      },
    });
    pi.registerTool({
      name: "update_suggestion",
      label: "Update suggestion",
      description: "Refine an existing live suggestion without editing draft.md.",
      parameters: Type.Intersect([suggestionSchema, Type.Object({ id: Type.String() })]),
      execute: async (_id, params) => {
        const input = params as SuggestionInput & { id: string };
        return executeSuggestionMutation(host, "agent.suggestion.update", {
          item: toSuggestion(input, input.id),
        });
      },
    });
    pi.registerTool({
      name: "retract_suggestion",
      label: "Retract suggestion",
      description: "Retract an existing live suggestion.",
      parameters: Type.Object({ id: Type.String() }),
      execute: async (_id, params) =>
        executeSuggestionMutation(host, "agent.suggestion.retract", {
          id: params.id,
        }),
    });
    pi.registerTool({
      name: "wait_for_changes",
      label: "Wait for changes",
      description: "Yield after all useful work for the active durable revision is complete.",
      parameters: Type.Object({}),
      execute: async () => {
        const yielded = host.loop.requestYield();
        host.persist();
        return toolResult(yielded
          ? "Yield accepted. End this response now; Scribe will wake you on the next project revision."
          : "A newer revision arrived during this cycle. Do not yield; review the latest revision next.");
      },
    });
  };
}
