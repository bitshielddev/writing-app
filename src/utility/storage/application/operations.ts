import type {
  DocumentSnapshot,
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

  catalog() {
    return {
      projects: this.deps.projects.list!(),
      documents: this.deps.documents.list!(),
      selection: this.selection(),
    };
  }

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

  renameProject(input: Params<"project.rename">) {
    this.deps.projects.rename!(input.projectId, requiredLabel(input.name, "Project name"), this.deps.clock.now());
    return this.catalog();
  }

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

  selectProject(input: Params<"project.select">) {
    this.deps.projects.get(input.projectId);
    const document = this.deps.documents.list!(input.projectId)[0];
    if (!document) throw new Error("Project has no documents");
    this.deps.selections!.set(input.projectId, document.id, this.deps.clock.now());
    return this.catalog();
  }

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

  renameDocument(input: Params<"document.rename">) {
    this.deps.documents.rename!(
      input.projectId, input.documentId, requiredLabel(input.title, "Document title"), this.deps.clock.now(),
    );
    return this.catalog();
  }

  async deleteDocument(input: Params<"document.delete">) {
    const selected = this.selection();
    if (selected.projectId === input.projectId && selected.documentId === input.documentId) {
      throw new Error("ACTIVE_DOCUMENT_DELETE_FORBIDDEN");
    }
    this.deps.documents.delete!(input.projectId, input.documentId);
    await this.workspace(input).files.removeWorkspace?.();
    return this.catalog();
  }

  selectDocument(input: Params<"document.select">) {
    this.assertScope(input);
    this.deps.selections!.set(input.projectId, input.documentId, this.deps.clock.now());
    return this.catalog();
  }

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

  replayEvents(input: Params<"events.replay">) {
    this.assertScope(input);
    if (input.streamId !== streamFor(input.documentId)) throw new Error("UNKNOWN_EVENT_STREAM");
    return this.deps.outbox.replay(input.streamId, input.afterSequence, input.limit);
  }

  acknowledgeEvents(input: Params<"events.acknowledge">) {
    this.assertScope(input);
    if (input.streamId !== streamFor(input.documentId)) throw new Error("UNKNOWN_EVENT_STREAM");
    return { streamId: input.streamId, acknowledgedSequence: this.deps.outbox.acknowledge(
      input.consumerId, input.streamId, input.sequence,
    ) };
  }

  async repairWorkspace(input?: Params<"workspace.repair">) {
    input ??= this.selection();
    this.assertScope(input);
    const workspace = this.workspace(input);
    const result = await workspace.files.repairDraft(
      this.deps.documents.get(input.projectId, input.documentId).markdown,
    );
    return { ...workspace.descriptor, ...result };
  }

  async saveDocument(input: Omit<Params<"document.save">, "projectId"> & { projectId?: string }): Promise<DocumentSnapshot> {
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

  private async performDocumentSave(input: Params<"document.save">) {
    const { files } = this.workspace(input);
    const current = this.deps.documents.get(input.projectId, input.documentId);
    assertDocumentRevision(input.expectedRevision, current.revision);
    if (JSON.stringify(input.blocks) === JSON.stringify(current.blocks) && input.markdown === current.markdown) return current;
    await files.writeDraft(input.markdown);
    let saved: DocumentSnapshot;
    try {
      saved = this.deps.transactions.run(() => {
        assertDocumentRevision(input.expectedRevision,
          this.deps.documents.get(input.projectId, input.documentId).revision);
        const now = this.deps.clock.now();
        const document = this.deps.documents.save(
          input.projectId, input.documentId, input.blocks, input.markdown, now,
        );
        this.deps.projects.incrementRevision(input.projectId, now);
        this.deps.outbox.enqueue(input.projectId, input.documentId, {
          type: "document.saved", document,
          projectRevision: this.deps.projects.get(input.projectId).revision,
        });
        return document;
      });
    } catch (error) {
      try { await files.repairDraft(this.deps.documents.get(input.projectId, input.documentId).markdown); }
      catch (repairError) { throw new AggregateError([error, repairError], "Document save failed and draft repair failed", { cause: repairError }); }
      throw error;
    }
    await this.deps.dispatcher.dispatch();
    return saved;
  }

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

  getObservationSeed(input: Params<"agent.seed">): ObservationSeed {
    this.assertScope(input);
    const project = this.deps.projects.get(input.projectId);
    const document = this.deps.documents.get(input.projectId, input.documentId);
    const streamId = streamFor(input.documentId);
    return { streamId, coveredThroughSequence: this.deps.outbox.head(streamId), projectId: project.id,
      projectName: project.name, projectRevision: project.revision, documentId: document.id,
      documentTitle: document.title, documentRevision: document.revision };
  }

  listSuggestions(input: Params<"agent.suggestions.list">) {
    this.assertScope(input);
    const state = this.deps.suggestions.get(input.projectId, input.documentId).state;
    return { live: state.entries.map((entry) => entry.item), pinned: state.pinnedEntries.map((entry) => entry.item),
      workspace: state.workspacePins.map((entry) => entry.item) };
  }

  async createSuggestion(input: Params<"agent.suggestion.create">) {
    return this.mutateSuggestion(input, { type: "publish", item: input.item }, { type: "agent" });
  }
  async updateSuggestion(input: Params<"agent.suggestion.update">) {
    return this.mutateSuggestion(input, { type: "update", item: input.item }, { type: "agent" });
  }
  async retractSuggestion(input: Params<"agent.suggestion.retract">) {
    return this.mutateSuggestion(input, { type: "retract", suggestionId: input.id }, { type: "agent" });
  }

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

  private assertCurrentRevision(scope: Scope, expected: number) {
    assertSuggestionDocumentRevision(expected, this.deps.documents.get(scope.projectId, scope.documentId).revision);
  }

  private publishSuggestionFacts(scope: Scope,
    events: Array<{ eventId: string }>) {
    for (const event of events) {
      this.deps.outbox.enqueueSuggestionFact(scope.projectId, scope.documentId, event.eventId);
    }
  }

  private assertScope(scope: Scope) {
    this.deps.projects.get(scope.projectId);
    this.deps.documents.get(scope.projectId, scope.documentId);
  }

  private selection() {
    if (this.deps.selections) return this.deps.selections.resolve();
    if (this.deps.projectId && this.deps.documentId) return { projectId: this.deps.projectId, documentId: this.deps.documentId };
    throw new Error("Workspace selection is unavailable");
  }

  private workspace(scope: Scope) {
    if (this.deps.workspaces) return this.deps.workspaces.forDocument(scope.projectId, scope.documentId);
    if (this.deps.workspace && this.deps.files) return { descriptor: this.deps.workspace, files: this.deps.files };
    throw new Error("Document workspace is unavailable");
  }
}

const streamFor = (documentId: string) => `document:${documentId}`;
const scopeKey = (scope: Scope) => `${scope.projectId}:${scope.documentId}`;
function requiredLabel(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}
