import type {
  DocumentSnapshot,
  DocumentSaveReceipt,
  ObservationSeed,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../../../contracts/desktop-bridge.js";
import {
  type OperationParams,
} from "../../../contracts/base.js";
import { StorageOperations as StorageOperationContracts } from "../../../contracts/operations/storage.js";
import type { DurableSuggestionCommand } from "../../../domain/suggestions/transitions.js";
import type {
  Clock, DocumentStore, EventDispatcher, EventOutbox, IdentityGenerator,
  ProjectStore, SelectionStore, SourceStore, SuggestionStore, TransactionManager,
  WorkspaceFilesFactory,
} from "./ports.js";
import { assertDocumentRevision, assertSuggestionDocumentRevision } from "./revisions.js";
import {
  decideSuggestionCommand,
  SUGGESTION_COMMAND_VERSION,
  type SuggestionActor,
  type SuggestionCommandEnvelope,
  type SuggestionIntent,
} from "../../../domain/suggestions/aggregate.js";
import { suggestionContentDedupeKey } from "../../../domain/suggestions/dedupe.js";
import { plainTextBlocksFromBlocks } from "../../../domain/document/plain-text.js";

type Params<Name extends keyof typeof StorageOperationContracts> = OperationParams<typeof StorageOperationContracts, Name>;
type Scope = { projectId: string; documentId: string };

export type StorageOperationDependencies = {
  transactions: TransactionManager;
  projectId?: string;
  documentId?: string;
  projects: ProjectStore;
  documents: DocumentStore;
  selections?: SelectionStore;
  sources: SourceStore;
  suggestions: SuggestionStore;
  outbox: EventOutbox;
  dispatcher: EventDispatcher;
  workspaces?: WorkspaceFilesFactory;
  workspace?: ReturnType<WorkspaceFilesFactory["forDocument"]>["descriptor"];
  files?: ReturnType<WorkspaceFilesFactory["forDocument"]>["files"];
  clock: Clock;
  identities: IdentityGenerator;
  logger?: Pick<Console, "error">;
};

export class StorageOperations {
  private readonly logger: Pick<Console, "error">;
  private readonly documentOperations = new Map<string, Promise<void>>();

  constructor(private readonly deps: StorageOperationDependencies) {
    this.logger = deps.logger ?? console;
  }

  /**
   * What: performs the catalog step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createProject, renameProject, deleteProject and selectProject when that path needs this behavior.
   */
  catalog() {
    return {
      projects: this.deps.projects.list!(),
      documents: this.deps.documents.list!(),
      selection: this.selection(),
    };
  }

  /**
   * What: creates project with the dependencies and defaults this workflow expects.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  createProject(input: Params<"project.create">) {
    const name = requiredLabel(input.name, "Project name");
    return this.deps.transactions.run(() => {
      const now = this.deps.clock.now();
      const projectId = this.deps.identities.next();
      const documentId = this.deps.identities.next();
      this.deps.projects.create!(projectId, name, now);
      this.deps.documents.create!(projectId, documentId, "Untitled Draft", now);
      this.deps.selections!.set(projectId, documentId, now);
      return this.catalog();
    });
  }

  /**
   * What: renames project and keeps dependent state in sync.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  renameProject(input: Params<"project.rename">) {
    this.deps.projects.rename!(input.projectId, requiredLabel(input.name, "Project name"), this.deps.clock.now());
    return this.catalog();
  }

  /**
   * What: deletes project and updates related state.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async deleteProject(input: Params<"project.delete">) {
    const selected = this.selection();
    if (selected.projectId === input.projectId) throw new Error("ACTIVE_PROJECT_DELETE_FORBIDDEN");
    if (this.deps.projects.list!().length <= 1) throw new Error("LAST_PROJECT_DELETE_FORBIDDEN");
    const documents = this.deps.documents.list!(input.projectId);
    this.deps.projects.delete!(input.projectId);
    await Promise.all(documents.map((document) =>
      this.workspace({ projectId: input.projectId, documentId: document.id }).files.removeWorkspace?.()));
    return this.catalog();
  }

  /**
   * What: selects project from the current state for UI or application callers.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  selectProject(input: Params<"project.select">) {
    this.deps.projects.get(input.projectId);
    const document = this.deps.documents.list!(input.projectId)[0];
    if (!document) throw new Error("Project has no documents");
    this.deps.selections!.set(input.projectId, document.id, this.deps.clock.now());
    return this.catalog();
  }

  /**
   * What: creates document with the dependencies and defaults this workflow expects.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  createDocument(input: Params<"document.create">) {
    const title = requiredLabel(input.title, "Document title");
    return this.deps.transactions.run(() => {
      this.deps.projects.get(input.projectId);
      const documentId = this.deps.identities.next();
      this.deps.documents.create!(input.projectId, documentId, title, this.deps.clock.now());
      this.deps.selections!.set(input.projectId, documentId, this.deps.clock.now());
      return this.catalog();
    });
  }

  /**
   * What: renames document and keeps dependent state in sync.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  renameDocument(input: Params<"document.rename">) {
    this.deps.documents.rename!(
      input.projectId, input.documentId, requiredLabel(input.title, "Document title"), this.deps.clock.now(),
    );
    return this.catalog();
  }

  /**
   * What: deletes document and updates related state.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async deleteDocument(input: Params<"document.delete">) {
    const selected = this.selection();
    if (selected.projectId === input.projectId && selected.documentId === input.documentId) {
      throw new Error("ACTIVE_DOCUMENT_DELETE_FORBIDDEN");
    }
    this.deps.documents.delete!(input.projectId, input.documentId);
    await this.workspace(input).files.removeWorkspace?.();
    return this.catalog();
  }

  /**
   * What: selects document from the current state for UI or application callers.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  selectDocument(input: Params<"document.select">) {
    this.assertScope(input);
    this.deps.selections!.set(input.projectId, input.documentId, this.deps.clock.now());
    return this.catalog();
  }

  /**
   * What: performs the hydrate step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  hydrate(input?: Params<"hydrate">): WorkspaceSnapshot {
    input ??= this.selection();
    this.assertScope(input);
    const streamId = streamFor(input.documentId);
    const suggestion = this.deps.suggestions.get(input.projectId, input.documentId);
    return {
      streamId,
      coveredThroughSequence: this.deps.outbox.head(streamId),
      project: this.deps.projects.get(input.projectId),
      document: this.deps.documents.get(input.projectId, input.documentId),
      sources: this.deps.sources.list(input.projectId, input.documentId),
      suggestions: suggestion.state,
      suggestionRevision: suggestion.revision,
      agent: { status: "offline", cycleCount: 0 },
      activity: [],
    };
  }

  /**
   * What: performs the replay events step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  replayEvents(input: Params<"events.replay">) {
    this.assertScope(input);
    if (input.streamId !== streamFor(input.documentId)) throw new Error("UNKNOWN_EVENT_STREAM");
    return this.deps.outbox.replay(input.streamId, input.afterSequence, input.limit);
  }

  /**
   * What: performs the acknowledge events step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  acknowledgeEvents(input: Params<"events.acknowledge">) {
    this.assertScope(input);
    if (input.streamId !== streamFor(input.documentId)) throw new Error("UNKNOWN_EVENT_STREAM");
    return { streamId: input.streamId, acknowledgedSequence: this.deps.outbox.acknowledge(
      input.consumerId, input.streamId, input.sequence,
    ) };
  }

  /**
   * What: performs the repair workspace step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * What: saves document through the configured persistence path.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by operations and createStorageRequestHandler when that path needs this behavior.
   */
  async saveDocument(input: Omit<Params<"document.save">, "projectId"> & { projectId?: string }): Promise<DocumentSaveReceipt> {
    const scoped = { ...this.selection(), ...input } as Params<"document.save">;
    this.assertScope(scoped);
    const key = scopeKey(scoped);
    const previous = this.documentOperations.get(key) ?? Promise.resolve();
    let release!: () => void;
    this.documentOperations.set(key, new Promise<void>((resolve) => { release = resolve; }));
    await previous;
    try { return await this.performDocumentSave(scoped); }
    finally { release(); }
  }

  /**
   * What: performs the perform document save step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by saveDocument when that path needs this behavior.
   */
  private async performDocumentSave(input: Params<"document.save">) {
    const current = this.deps.documents.get(input.projectId, input.documentId);
    assertDocumentRevision(input.expectedRevision, current.revision);
    const receipt = (document: DocumentSnapshot): DocumentSaveReceipt => ({
      projectId: document.projectId,
      documentId: document.id,
      documentRevision: document.revision,
      projectRevision: this.deps.projects.get(input.projectId).revision,
      updatedAt: document.updatedAt,
    });
    if (JSON.stringify(input.blocks) === JSON.stringify(current.blocks)) return receipt(current);
    const saved = this.deps.transactions.run(() => {
      assertDocumentRevision(input.expectedRevision,
        this.deps.documents.get(input.projectId, input.documentId).revision);
      const now = this.deps.clock.now();
      const document = this.deps.documents.save(
        input.projectId, input.documentId, input.blocks, now,
      );
      this.deps.projects.incrementRevision(input.projectId, now);
      const savedReceipt = receipt(document);
      this.deps.outbox.enqueue(input.projectId, input.documentId, {
        type: "document.saved", ...savedReceipt,
      });
      return savedReceipt;
    });
    await this.deps.dispatcher.dispatch();
    return saved;
  }

  /**
   * What: performs the import source step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async importSource(input: Params<"source.import">): Promise<SourceSnapshot> {
    this.assertScope(input);
    const { files } = this.workspace(input);
    const copied = await files.copySource(input.path);
    const id = this.deps.identities.next();
    let source: SourceSnapshot;
    try {
      source = this.deps.transactions.run(() => {
        const now = this.deps.clock.now();
        const inserted: SourceSnapshot = { id, projectId: input.projectId, documentId: input.documentId,
          title: copied.filename, storagePath: copied.destination, bytes: copied.bytes, updatedAt: now };
        this.deps.sources.insert(inserted, now);
        this.deps.projects.incrementRevision(input.projectId, now);
        const persisted = this.deps.sources.get(input.projectId, input.documentId, id);
        this.deps.outbox.enqueue(input.projectId, input.documentId, { type: "source.imported", source: persisted,
          projectRevision: this.deps.projects.get(input.projectId).revision });
        return persisted;
      });
    } catch (error) {
      try { await files.removeSource(copied.destination); }
      catch (cleanupError) { this.logger.error(`Failed to remove copied source after database failure: ${copied.destination}`, cleanupError); }
      throw error;
    }
    await this.deps.dispatcher.dispatch();
    return source;
  }

  /**
   * What: performs the execute suggestion command step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async executeSuggestionCommand(input: Params<"suggestions.command">) {
    this.assertScope(input);
    const duplicate = this.deps.suggestions.findReceipt(input.projectId, input.documentId, input.commandId);
    if (duplicate) return duplicate;
    const result = this.deps.transactions.run(() => {
      const repeated = this.deps.suggestions.findReceipt(input.projectId, input.documentId, input.commandId);
      if (repeated) return repeated;
      const command: SuggestionCommandEnvelope = {
        commandId: input.commandId, projectId: input.projectId, documentId: input.documentId,
        actor: { type: "writer" }, version: SUGGESTION_COMMAND_VERSION,
        command: input.command as DurableSuggestionCommand,
        expectedSuggestionRevision: input.expectedSuggestionRevision,
        requestedAt: this.deps.clock.now(),
      };
      const current = this.deps.suggestions.get(input.projectId, input.documentId);
      if (input.expectedSuggestionRevision !== current.revision) {
        const conflict = { commandId: input.commandId, status: "conflict" as const,
          suggestionRevision: current.revision, state: current.state,
          reason: "Suggestion state changed before the command was applied" };
        this.deps.suggestions.recordCommandReceipt(command, conflict, undefined,
          current.coveredThroughSequence, "SUGGESTION_REVISION_CONFLICT");
        return conflict;
      }
      const decision = decideSuggestionCommand(current.state, command.command);
      if (decision.status === "rejected") {
        const rejected = { commandId: input.commandId, status: "rejected" as const,
          suggestionRevision: current.revision, state: current.state, reason: decision.reason };
        this.deps.suggestions.recordCommandReceipt(command, rejected, undefined,
          current.coveredThroughSequence, "SUGGESTION_COMMAND_REJECTED");
        return rejected;
      }
      const persisted = decision.status === "changed"
        ? this.deps.suggestions.appendFacts(command, decision.facts,
          decision.facts.map(() => this.deps.identities.next()))
        : { projection: current, events: [] };
      const projection = persisted.projection;
      const applied = { commandId: input.commandId,
        status: decision.status === "changed" ? "applied" as const : "unchanged" as const,
        suggestionRevision: projection.revision, state: projection.state };
      this.deps.suggestions.recordCommandReceipt(command, applied,
        persisted.events[0]?.sequence, projection.coveredThroughSequence);
      if (decision.status === "changed") this.publishSuggestionFacts(input, persisted.events);
      return applied;
    });
    this.deps.suggestions.createCheckpoint(input.projectId, input.documentId);
    await this.deps.dispatcher.dispatch();
    return result;
  }

  /**
   * What: reads observation seed for callers that need the derived value.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  getObservationSeed(input: Params<"agent.seed">): ObservationSeed {
    this.assertScope(input);
    const project = this.deps.projects.get(input.projectId);
    const document = this.deps.documents.get(input.projectId, input.documentId);
    const streamId = streamFor(input.documentId);
    return { streamId, coveredThroughSequence: this.deps.outbox.head(streamId), projectId: project.id,
      projectName: project.name, projectRevision: project.revision, documentId: document.id,
      documentTitle: document.title, documentRevision: document.revision };
  }

  readAgentDocument(input: Params<"agent.document.read">) {
    this.assertScope(input);
    const document = this.deps.documents.get(input.projectId, input.documentId);
    return {
      projectId: document.projectId,
      documentId: document.id,
      title: document.title,
      documentRevision: document.revision,
      schemaVersion: document.schemaVersion,
      blocks: document.blocks,
      plainTextBlocks: plainTextBlocksFromBlocks(document.blocks),
    };
  }

  /**
   * What: lists suggestions from the current store.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  listSuggestions(input: Params<"agent.suggestions.list">) {
    this.assertScope(input);
    const state = this.deps.suggestions.get(input.projectId, input.documentId).state;
    return { live: state.entries.map((entry) => entry.item), pinned: state.pinnedEntries.map((entry) => entry.item),
      workspace: state.workspacePins.map((entry) => entry.item) };
  }

  /**
   * What: creates suggestion with the dependencies and defaults this workflow expects.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async createSuggestion(input: Params<"agent.suggestion.create">) {
    return this.mutateSuggestion(input, { type: "publish", item: input.item }, { type: "agent" });
  }
  /**
   * What: performs the update suggestion step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async updateSuggestion(input: Params<"agent.suggestion.update">) {
    return this.mutateSuggestion(input, { type: "update", item: input.item }, { type: "agent" });
  }
  /**
   * What: performs the retract suggestion step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageRequestHandler when that path needs this behavior.
   */
  async retractSuggestion(input: Params<"agent.suggestion.retract">) {
    return this.mutateSuggestion(input, { type: "retract", suggestionId: input.id }, { type: "agent" });
  }

  /**
   * What: performs the mutate suggestion step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createSuggestion, updateSuggestion and retractSuggestion when that path needs this behavior.
   */
  private async mutateSuggestion(input: Scope & { expectedDocumentRevision: number },
    intent: SuggestionIntent, actor: SuggestionActor) {
    this.assertScope(input);
    this.assertCurrentRevision(input, input.expectedDocumentRevision);
    const result = this.deps.transactions.run(() => {
      this.assertCurrentRevision(input, input.expectedDocumentRevision);
      const current = this.deps.suggestions.get(input.projectId, input.documentId);
      const command: SuggestionCommandEnvelope = {
        commandId: this.deps.identities.next(), projectId: input.projectId,
        documentId: input.documentId, actor, version: SUGGESTION_COMMAND_VERSION, command: intent,
        expectedSuggestionRevision: current.revision,
        expectedDocumentRevision: input.expectedDocumentRevision, requestedAt: this.deps.clock.now(),
      };
      if (intent.type === "publish" &&
        this.deps.suggestions.hasSeenContentDedupeKey?.(
          input.projectId,
          input.documentId,
          suggestionContentDedupeKey(intent.item),
        )) {
        const receipt = { commandId: command.commandId, status: "rejected" as const,
          suggestionRevision: current.revision, state: current.state,
          reason: "Duplicate suggestion content" };
        this.deps.suggestions.recordCommandReceipt(command, receipt, undefined,
          current.coveredThroughSequence, "SUGGESTION_DUPLICATE_CONTENT");
        return { accepted: false };
      }
      const decision = decideSuggestionCommand(current.state, intent);
      if (decision.status !== "changed") {
        const receipt = { commandId: command.commandId, status: "rejected" as const,
          suggestionRevision: current.revision, state: current.state,
          reason: decision.status === "rejected" ? decision.reason : "Suggestion state was unchanged" };
        this.deps.suggestions.recordCommandReceipt(command, receipt, undefined,
          current.coveredThroughSequence, "SUGGESTION_COMMAND_REJECTED");
        return { accepted: false };
      }
      const persisted = this.deps.suggestions.appendFacts(command, decision.facts,
        decision.facts.map(() => this.deps.identities.next()));
      const receipt = { commandId: command.commandId, status: "applied" as const,
        suggestionRevision: persisted.projection.revision, state: persisted.projection.state };
      this.deps.suggestions.recordCommandReceipt(command, receipt,
        persisted.events[0]?.sequence, persisted.projection.coveredThroughSequence);
      this.publishSuggestionFacts(input, persisted.events);
      return { accepted: true };
    });
    this.deps.suggestions.createCheckpoint(input.projectId, input.documentId);
    await this.deps.dispatcher.dispatch();
    return result;
  }

  /**
   * What: checks current revision and throws before invalid state crosses the boundary.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by mutateSuggestion when that path needs this behavior.
   */
  private assertCurrentRevision(scope: Scope, expected: number) {
    assertSuggestionDocumentRevision(expected, this.deps.documents.get(scope.projectId, scope.documentId).revision);
  }

  /**
   * What: performs the publish suggestion facts step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by executeSuggestionCommand and mutateSuggestion when that path needs this behavior.
   */
  private publishSuggestionFacts(scope: Scope,
    events: Array<{ eventId: string }>) {
    for (const event of events) {
      this.deps.outbox.enqueueSuggestionFact(scope.projectId, scope.documentId, event.eventId);
    }
  }

  /**
   * What: checks scope and throws before invalid state crosses the boundary.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by selectDocument, hydrate, replayEvents and acknowledgeEvents when that path needs this behavior.
   */
  private assertScope(scope: Scope) {
    this.deps.projects.get(scope.projectId);
    this.deps.documents.get(scope.projectId, scope.documentId);
  }

  /**
   * What: performs the selection step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by catalog, deleteProject, deleteDocument and hydrate when that path needs this behavior.
   */
  private selection() {
    if (this.deps.selections) return this.deps.selections.resolve();
    if (this.deps.projectId && this.deps.documentId) return { projectId: this.deps.projectId, documentId: this.deps.documentId };
    throw new Error("Workspace selection is unavailable");
  }

  /**
   * What: performs the workspace step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by deleteProject, deleteDocument and importSource when that path needs this behavior.
   */
  private workspace(scope: Scope) {
    if (this.deps.workspaces) return this.deps.workspaces.forDocument(scope.projectId, scope.documentId);
    if (this.deps.workspace && this.deps.files) return { descriptor: this.deps.workspace, files: this.deps.files };
    throw new Error("Document workspace is unavailable");
  }
}

/**
 * What: performs the stream for step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by hydrate, replayEvents, acknowledgeEvents and getObservationSeed when that path needs this behavior.
 */
const streamFor = (documentId: string) => `document:${documentId}`;
/**
 * What: performs the scope key step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by saveDocument when that path needs this behavior.
 */
const scopeKey = (scope: Scope) => `${scope.projectId}:${scope.documentId}`;
/**
 * What: performs the required label step for this file's workflow.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by createProject, renameProject, createDocument and renameDocument when that path needs this behavior.
 */
function requiredLabel(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}
