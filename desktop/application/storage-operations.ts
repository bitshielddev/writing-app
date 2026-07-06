import type {
  DocumentSnapshot,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../../src/shared/desktop.js";
import {
  DEFAULT_EVENT_STREAM_ID,
  StorageOperations as StorageOperationContracts,
  type OperationParams,
} from "../../src/shared/contracts.js";
import type { PersistedSuggestionState } from "../../src/suggestions/state.js";
import type { SuggestionEvent } from "../../src/suggestions/types.js";
import { applySuggestionAgentEvent, applySuggestionCommand } from "../../src/suggestions/transitions.js";
import {
  type Clock,
  type DocumentStore,
  type EventDispatcher,
  type EventOutbox,
  type IdentityGenerator,
  type ProjectStore,
  type SourceStore,
  type SuggestionStore,
  type TransactionManager,
  type WorkspaceDescriptor,
  type WorkspaceFiles,
} from "./storage-ports.js";
import {
  assertDocumentRevision,
  assertSuggestionDocumentRevision,
} from "../domain/revisions.js";

type Params<Name extends keyof typeof StorageOperationContracts> = OperationParams<
  typeof StorageOperationContracts,
  Name
>;

export type StorageOperationDependencies = {
  projectId: string;
  documentId: string;
  workspace: WorkspaceDescriptor;
  transactions: TransactionManager;
  projects: ProjectStore;
  documents: DocumentStore;
  sources: SourceStore;
  suggestions: SuggestionStore;
  outbox: EventOutbox;
  dispatcher: EventDispatcher;
  files: WorkspaceFiles;
  clock: Clock;
  identities: IdentityGenerator;
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
      streamId: DEFAULT_EVENT_STREAM_ID,
      coveredThroughSequence: this.deps.outbox.head(DEFAULT_EVENT_STREAM_ID),
      project: this.deps.projects.get(this.deps.projectId),
      document: this.deps.documents.get(this.deps.documentId),
      sources: this.deps.sources.list(this.deps.projectId),
      suggestions: this.deps.suggestions.get(this.deps.projectId).state,
      suggestionRevision: this.deps.suggestions.get(this.deps.projectId).revision,
      agent: { status: "offline", cycleCount: 0 },
      activity: [],
    };
  }

  replayEvents(input: Params<"events.replay">) {
    return this.deps.outbox.replay(input.streamId, input.afterSequence, input.limit);
  }

  acknowledgeEvents(input: Params<"events.acknowledge">) {
    return { streamId: input.streamId, acknowledgedSequence: this.deps.outbox.acknowledge(
      input.consumerId, input.streamId, input.sequence,
    ) };
  }

  async repairWorkspace() {
    const result = await this.deps.files.repairDraft(
      this.deps.documents.get(this.deps.documentId).markdown,
    );
    return { ...this.deps.workspace, ...result };
  }

  async saveDocument(input: Params<"document.save">): Promise<DocumentSnapshot> {
    const previous = this.documentOperation;
    let release!: () => void;
    this.documentOperation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.performDocumentSave(input);
    } finally {
      release();
    }
  }

  private async performDocumentSave(input: Params<"document.save">): Promise<DocumentSnapshot> {
    if (input.documentId !== this.deps.documentId) throw new Error("Invalid document identity");

    const current = this.deps.documents.get(this.deps.documentId);
    assertDocumentRevision(input.expectedRevision, current.revision);
    if (
      JSON.stringify(input.blocks) === JSON.stringify(current.blocks) &&
      input.markdown === current.markdown
    ) return current;

    await this.deps.files.writeDraft(input.markdown);
    let saved: DocumentSnapshot;
    try {
      saved = this.deps.transactions.run(() => {
        assertDocumentRevision(
          input.expectedRevision,
          this.deps.documents.get(this.deps.documentId).revision,
        );
        const now = this.deps.clock.now();
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

  async importSource({ path: sourcePath }: Params<"source.import">): Promise<SourceSnapshot> {
    const copied = await this.deps.files.copySource(sourcePath);
    const id = this.deps.identities.next();
    let source: SourceSnapshot;
    try {
      source = this.deps.transactions.run(() => {
        const now = this.deps.clock.now();
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

  async executeSuggestionCommand(input: Params<"suggestions.command">) {
    if (input.documentId !== this.deps.documentId) throw new Error("Invalid document identity");
    const duplicate = this.deps.suggestions.findReceipt(input.commandId);
    if (duplicate) return duplicate;

    const result = this.deps.transactions.run(() => {
      const repeated = this.deps.suggestions.findReceipt(input.commandId);
      if (repeated) return repeated;
      const current = this.deps.suggestions.get(this.deps.projectId);
      if (input.expectedSuggestionRevision !== current.revision) {
        const conflict = { commandId: input.commandId, status: "conflict" as const,
          suggestionRevision: current.revision, state: current.state,
          reason: "Suggestion state changed before the command was applied" };
        this.deps.suggestions.recordReceipt(this.deps.projectId, conflict);
        return conflict;
      }
      const transition = applySuggestionCommand(current.state, input.command);
      if (transition.status === "rejected") {
        const rejected = { commandId: input.commandId, status: "rejected" as const,
          suggestionRevision: current.revision, state: current.state, reason: transition.reason };
        this.deps.suggestions.recordReceipt(this.deps.projectId, rejected);
        return rejected;
      }
      const projection = transition.status === "changed"
        ? this.deps.suggestions.compareAndPut(this.deps.projectId, current.revision, transition.state)
        : current;
      const applied = { commandId: input.commandId,
        status: transition.status === "changed" ? "applied" as const : "unchanged" as const,
        suggestionRevision: projection.revision, state: projection.state };
      this.deps.suggestions.recordReceipt(this.deps.projectId, applied);
      if (transition.status === "changed") this.emitSuggestion(
        { type: "suggestion.state.changed", suggestionId: input.command.suggestionId, commandType: input.command.type },
        projection,
        input.commandId,
      );
      return applied;
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  getObservationSeed(): ObservationSeed {
    const project = this.deps.projects.get(this.deps.projectId);
    const document = this.deps.documents.get(this.deps.documentId);
    return {
      streamId: DEFAULT_EVENT_STREAM_ID,
      coveredThroughSequence: this.deps.outbox.head(DEFAULT_EVENT_STREAM_ID),
      projectId: project.id,
      projectName: project.name,
      projectRevision: project.revision,
      documentId: document.id,
      documentTitle: document.title,
      documentRevision: document.revision,
    };
  }

  listSuggestions() {
    const state = this.deps.suggestions.get(this.deps.projectId).state;
    return {
      live: state.entries.map((entry) => entry.item),
      pinned: state.pinnedEntries.map((entry) => entry.item),
      workspace: state.workspacePins.map((entry) => entry.item),
    };
  }

  async createSuggestion(input: Params<"agent.suggestion.create">) {
    const item = input.item;
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      this.assertCurrentRevision(input.expectedDocumentRevision);
      return this.applyAgentEvent({ type: "suggestion.added", item });
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  createDevelopmentSuggestion({ item }: Params<"development.suggestion.create">) {
    return this.createSuggestion({
      item,
      expectedDocumentRevision: this.deps.documents.get(this.deps.documentId).revision,
    });
  }

  async updateSuggestion(input: Params<"agent.suggestion.update">) {
    const item = input.item;
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      this.assertCurrentRevision(input.expectedDocumentRevision);
      return this.applyAgentEvent({ type: "suggestion.updated", item });
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  async retractSuggestion(input: Params<"agent.suggestion.retract">) {
    this.assertCurrentRevision(input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      this.assertCurrentRevision(input.expectedDocumentRevision);
      return this.applyAgentEvent({ type: "suggestion.retracted", id: input.id });
    });
    await this.deps.dispatcher.dispatch();
    return result;
  }

  private assertCurrentRevision(expected: number) {
    assertSuggestionDocumentRevision(
      expected,
      this.deps.documents.get(this.deps.documentId).revision,
    );
  }

  private applyAgentEvent(event: SuggestionEvent) {
    const current = this.deps.suggestions.get(this.deps.projectId);
    const transition = applySuggestionAgentEvent(current.state, event);
    if (transition.status !== "changed") return { accepted: false };
    const projection = this.deps.suggestions.compareAndPut(this.deps.projectId, current.revision, transition.state);
    this.emitSuggestion(event, projection);
    return { accepted: true };
  }

  private emitSuggestion(
    event: SuggestionEvent,
    projection: { state: PersistedSuggestionState; revision: number },
    commandId?: string,
  ) {
    this.deps.outbox.enqueue({ type: "suggestion.event", event, commandId,
      suggestionRevision: projection.revision, state: projection.state }, commandId);
  }
}
