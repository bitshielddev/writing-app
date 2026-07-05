import { randomUUID } from "node:crypto";

import type {
  DocumentSnapshot,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../../src/shared/desktop.js";
import {
  StorageOperations as StorageOperationContracts,
  parseOrContractError,
} from "../../src/shared/contracts.js";
import { trimSuggestionEntries } from "../../src/suggestions/state.js";
import type { SuggestionEvent } from "../../src/suggestions/types.js";
import type { TransactionManager } from "./database-lifecycle.js";
import type { OutboxDispatcher } from "./outbox.js";
import {
  type DocumentStore,
  type EventOutbox,
  type ProjectStore,
  type SourceStore,
  type SuggestionStore,
} from "./repositories.js";
import type { StoragePaths } from "./config.js";
import type { WorkspaceFiles } from "./workspace-files.js";

export type StorageOperationDependencies = {
  projectId: string;
  documentId: string;
  paths: StoragePaths;
  transactions: TransactionManager;
  projects: ProjectStore;
  documents: DocumentStore;
  sources: SourceStore;
  suggestions: SuggestionStore;
  outbox: EventOutbox;
  dispatcher: OutboxDispatcher;
  files: WorkspaceFiles;
  logger?: Pick<Console, "error">;
};

export class StorageOperations {
  private readonly logger: Pick<Console, "error">;
  private documentOperation: Promise<void> = Promise.resolve();

  constructor(private readonly deps: StorageOperationDependencies) {
    this.logger = deps.logger ?? console;
  }

  hydrate(): WorkspaceSnapshot {
    return {
      project: this.deps.projects.get(this.deps.projectId),
      document: this.deps.documents.get(this.deps.documentId),
      sources: this.deps.sources.list(this.deps.projectId),
      suggestions: this.deps.suggestions.get(this.deps.projectId),
      agent: { status: "offline", cycleCount: 0 },
      activity: [],
    };
  }

  async repairWorkspace() {
    const result = await this.deps.files.repairDraft(
      this.deps.documents.get(this.deps.documentId).markdown,
    );
    return { ...this.deps.paths, ...result };
  }

  async saveDocument(params: unknown): Promise<DocumentSnapshot> {
    const previous = this.documentOperation;
    let release!: () => void;
    this.documentOperation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.performDocumentSave(params);
    } finally {
      release();
    }
  }

  private async performDocumentSave(params: unknown): Promise<DocumentSnapshot> {
    const input = parseOrContractError(
      StorageOperationContracts["document.save"].params,
      params,
      "storage.document.save.params",
    );
    if (input.documentId !== this.deps.documentId) throw new Error("Invalid document identity");

    const current = this.deps.documents.get(this.deps.documentId);
    if (input.expectedRevision !== current.revision) throw new Error("DOCUMENT_REVISION_CONFLICT");
    if (
      JSON.stringify(input.blocks) === JSON.stringify(current.blocks) &&
      input.markdown === current.markdown
    ) return current;

    await this.deps.files.writeDraft(input.markdown);
    let saved: DocumentSnapshot;
    try {
      saved = this.deps.transactions.run(() => {
        if (input.expectedRevision !== this.deps.documents.get(this.deps.documentId).revision) {
          throw new Error("DOCUMENT_REVISION_CONFLICT");
        }
        const now = Date.now();
        const document = this.deps.documents.save(
          this.deps.documentId,
          input.blocks,
          input.markdown,
          now,
        );
        this.deps.projects.incrementRevision(this.deps.projectId, now);
        this.deps.outbox.enqueue({
          type: "document.saved",
          document,
          projectRevision: this.deps.projects.get(this.deps.projectId).revision,
        });
        return document;
      });
    } catch (error) {
      try {
        await this.deps.files.repairDraft(
          this.deps.documents.get(this.deps.documentId).markdown,
        );
      } catch (repairError) {
        throw new AggregateError(
          [error, repairError],
          "Document save failed and draft repair failed",
          { cause: repairError },
        );
      }
      throw error;
    }
    await this.deps.dispatcher.dispatch();
    return saved;
  }

  async importSource(params: unknown): Promise<SourceSnapshot> {
    const { path: sourcePath } = parseOrContractError(
      StorageOperationContracts["source.import"].params,
      params,
      "storage.source.import.params",
    );
    const copied = await this.deps.files.copySource(sourcePath);
    const id = randomUUID();
    let source: SourceSnapshot;
    try {
      source = this.deps.transactions.run(() => {
        const now = Date.now();
        const inserted: SourceSnapshot = {
          id,
          projectId: this.deps.projectId,
          title: copied.filename,
          storagePath: copied.destination,
          bytes: copied.bytes,
          updatedAt: now,
        };
        this.deps.sources.insert(inserted, now);
        this.deps.projects.incrementRevision(this.deps.projectId, now);
        const persisted = this.deps.sources.get(id);
        this.deps.outbox.enqueue({
          type: "source.imported",
          source: persisted,
          projectRevision: this.deps.projects.get(this.deps.projectId).revision,
        });
        return persisted;
      });
    } catch (error) {
      try {
        await this.deps.files.removeSource(copied.destination);
      } catch (cleanupError) {
        this.logger.error(`Failed to remove copied source after database failure: ${copied.destination}`, cleanupError);
      }
      throw error;
    }
    await this.deps.dispatcher.dispatch();
    return source;
  }

  saveSuggestionState(params: unknown) {
    const state = parseOrContractError(
      StorageOperationContracts["suggestions.save"].params,
      params,
      "storage.suggestions.save.params",
    );
    this.deps.suggestions.put(this.deps.projectId, {
      ...state,
      entries: trimSuggestionEntries(state.entries),
    });
  }

  getObservationSeed(): ObservationSeed {
    const project = this.deps.projects.get(this.deps.projectId);
    const document = this.deps.documents.get(this.deps.documentId);
    return {
      projectId: project.id,
      projectName: project.name,
      projectRevision: project.revision,
      documentId: document.id,
      documentTitle: document.title,
      documentRevision: document.revision,
    };
  }

  listSuggestions() {
    const state = this.deps.suggestions.get(this.deps.projectId);
    return {
      live: state.entries.map((entry) => entry.item),
      pinned: state.pinnedEntries.map((entry) => entry.item),
      workspace: state.workspacePins.map((entry) => entry.item),
    };
  }

  async createSuggestion(params: unknown) {
    const input = parseOrContractError(
      StorageOperationContracts["agent.suggestion.create"].params,
      params,
      "storage.agent.suggestion.create.params",
    );
    const item = input.item;
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      const state = this.deps.suggestions.get(this.deps.projectId);
      if (state.seenKeys[item.dedupeKey]) return { accepted: false };
      state.seenKeys[item.dedupeKey] = true;
      state.entries.push({ item, viewed: false, stale: false, withdrawn: false });
      state.entries = trimSuggestionEntries(state.entries);
      this.deps.suggestions.put(this.deps.projectId, state);
      this.emitSuggestion({ type: "suggestion.added", item });
      return { accepted: true };
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  createDevelopmentSuggestion(params: unknown) {
    const { item } = parseOrContractError(
      StorageOperationContracts["development.suggestion.create"].params,
      params,
      "storage.development.suggestion.create.params",
    );
    return this.createSuggestion({
      item,
      expectedDocumentRevision: this.deps.documents.get(this.deps.documentId).revision,
    });
  }

  async updateSuggestion(params: unknown) {
    const input = parseOrContractError(
      StorageOperationContracts["agent.suggestion.update"].params,
      params,
      "storage.agent.suggestion.update.params",
    );
    const item = input.item;
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      const state = this.deps.suggestions.get(this.deps.projectId);
      const entry = state.entries.find((candidate) => candidate.item.id === item.id);
      if (!entry) return { accepted: false };
      entry.item = item;
      this.deps.suggestions.put(this.deps.projectId, state);
      this.emitSuggestion({ type: "suggestion.updated", item });
      return { accepted: true };
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  async retractSuggestion(params: unknown) {
    const input = parseOrContractError(
      StorageOperationContracts["agent.suggestion.retract"].params,
      params,
      "storage.agent.suggestion.retract.params",
    );
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      const state = this.deps.suggestions.get(this.deps.projectId);
      if (!state.entries.some((entry) => entry.item.id === input.id)) return { accepted: false };
      state.entries = state.entries.filter((entry) => entry.item.id !== input.id);
      this.deps.suggestions.put(this.deps.projectId, state);
      this.emitSuggestion({ type: "suggestion.retracted", id: input.id });
      return { accepted: true };
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  private assertCurrentRevision(expected: unknown) {
    if (!Number.isInteger(expected) || expected !== this.deps.documents.get(this.deps.documentId).revision) {
      throw new Error("STALE_SUGGESTION_REVISION");
    }
  }

  private emitSuggestion(event: SuggestionEvent) {
    this.deps.outbox.enqueue({ type: "suggestion.event", event });
  }
}
