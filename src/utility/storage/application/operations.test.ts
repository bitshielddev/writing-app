import { describe, expect, it, vi } from "vitest";

import type { DurableEventEnvelope, DocumentSnapshot } from "../../../contracts/desktop-bridge";
import { createEmptySuggestionState } from "../../../domain/suggestions/state";
import {
  StorageOperations,
  type StorageOperationDependencies,
} from "./operations";

function fixture() {
  const project = { id: "project", name: "Draft", revision: 0 };
  let document: DocumentSnapshot = {
    id: "document",
    projectId: project.id,
    title: "Draft",
    blocks: [],
    markdown: "old\n",
    schemaVersion: 1,
    revision: 0,
    updatedAt: 0,
  };
  const events: DurableEventEnvelope[] = [];
  const repairDraft = vi.fn(async () => ({ repaired: true }));
  const dispatcher = { dispatch: vi.fn(async () => undefined) };
  const deps: StorageOperationDependencies = {
    projectId: project.id,
    documentId: document.id,
    workspace: {
      workspaceRoot: "/workspace",
      draftPath: "/workspace/draft.md",
      sourcesDirectory: "/workspace/sources",
      piDirectory: "/workspace/.pi",
    },
    transactions: { run: (work) => work() },
    projects: {
      get: () => ({ ...project }),
      incrementRevision: (_id, updatedAt) => {
        project.revision += 1;
        void updatedAt;
      },
    },
    documents: {
      get: () => structuredClone(document),
      save: (_projectId, _id, blocks, markdown, updatedAt) => {
        document = {
          ...document,
          blocks,
          markdown,
          updatedAt,
          revision: document.revision + 1,
        };
        return structuredClone(document);
      },
    },
    sources: { list: () => [], insert: () => undefined, get: () => { throw new Error("missing"); } },
    suggestions: {
      get: () => ({ state: createEmptySuggestionState(), revision: 0 }),
      compareAndPut: () => ({ state: createEmptySuggestionState(), revision: 1 }),
      findReceipt: () => undefined,
      recordReceipt: () => undefined,
      appendFacts: () => ({ projection: { state: createEmptySuggestionState(), revision: 1 }, events: [] }),
      recordCommandReceipt: () => undefined,
      createCheckpoint: () => undefined,
    },
    outbox: {
      enqueue: (_projectId, _documentId, payload, causationId) => {
        const event = {
          eventId: `event-${events.length + 1}`,
          streamId: "document:document",
          sequence: events.length + 1,
          occurredAt: 42,
          causationId,
          payload,
        };
        events.push(event);
        return event;
      },
      enqueueSuggestionFact: () => { throw new Error("not used"); },
      pending: () => events,
      markDispatched: () => undefined,
      replay: () => ({
        streamId: "document:document",
        events,
        headSequence: events.length,
        hasMore: false,
        historyAvailable: true,
      }),
      head: () => events.length,
      acknowledge: (_consumer, _stream, sequence) => sequence,
    },
    dispatcher,
    files: {
      writeDraft: vi.fn(async () => undefined),
      repairDraft,
      copySource: vi.fn(),
      removeSource: vi.fn(),
    },
    clock: { now: () => 42 },
    identities: { next: () => "generated-id" },
  };
  return { deps, dispatcher, events, repairDraft, getDocument: () => document };
}

describe("storage application operations", () => {
  it("saves through ports and creates a durable event", async () => {
    const context = fixture();
    const operations = new StorageOperations(context.deps);

    const saved = await operations.saveDocument({
      documentId: "document",
      expectedRevision: 0,
      blocks: [{ type: "paragraph", content: "new" }],
      markdown: "new\n",
    });

    expect(saved).toMatchObject({ revision: 1, updatedAt: 42 });
    expect(context.events[0]?.payload).toMatchObject({
      type: "document.saved",
      projectRevision: 1,
    });
    expect(context.dispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it("rejects a stale revision before writing", async () => {
    const context = fixture();
    const operations = new StorageOperations(context.deps);
    await expect(operations.saveDocument({
      documentId: "document",
      expectedRevision: 9,
      blocks: [],
      markdown: "stale\n",
    })).rejects.toThrow("DOCUMENT_REVISION_CONFLICT");
    expect(context.deps.files.writeDraft).not.toHaveBeenCalled();
  });

  it("compensates the draft mirror when persistence fails", async () => {
    const context = fixture();
    context.deps.documents.save = () => { throw new Error("database unavailable"); };
    const operations = new StorageOperations(context.deps);

    await expect(operations.saveDocument({
      documentId: "document",
      expectedRevision: 0,
      blocks: [],
      markdown: "new\n",
    })).rejects.toThrow("database unavailable");
    expect(context.repairDraft).toHaveBeenCalledWith(context.getDocument().markdown);
    expect(context.events).toEqual([]);
  });
});
