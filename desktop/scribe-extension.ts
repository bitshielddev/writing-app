import { randomUUID } from "node:crypto";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ScribeLoopState, type PersistedScribeLoopState } from "./scribe-loop.js";
import type { AgentActivity } from "../src/shared/desktop.js";
import type { SuggestionItem } from "../src/suggestions/types.js";
import {
  SuggestionToolInputSchema,
  SuggestionToolUpdateInputSchema,
  formatSuggestionValidationIssues,
  parseSuggestionItem,
  type SuggestionToolInput,
  type SuggestionToolUpdateInput,
} from "../src/suggestions/schema.js";

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

export function toSuggestion(
  input: SuggestionToolInput | SuggestionToolUpdateInput,
  id: string = "id" in input ? input.id : randomUUID(),
  createdAt: number = Date.now(),
): SuggestionItem {
  const parsed = parseSuggestionItem({ ...input, id, createdAt });
  if (parsed.success) return parsed.value;
  throw new Error(
    `Invalid suggestion: ${formatSuggestionValidationIssues(parsed.issues)}`,
  );
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
      parameters: SuggestionToolInputSchema,
      execute: async (_id, params) => {
        const item = toSuggestion(params as SuggestionToolInput);
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
      parameters: SuggestionToolUpdateInputSchema,
      execute: async (_id, params) => {
        const input = params as SuggestionToolUpdateInput;
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
