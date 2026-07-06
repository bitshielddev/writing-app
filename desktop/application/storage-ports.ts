import type {
  DurableEventEnvelope,
  DurableEventPayload,
  DocumentSnapshot,
  SourceSnapshot,
} from "../../src/shared/desktop.js";
import type { OperationResult } from "../../src/shared/contracts.js";
import { StorageOperations } from "../../src/shared/contracts.js";
import type { PersistedSuggestionState } from "../../src/suggestions/state.js";

export type ProjectSnapshot = { id: string; name: string; revision: number };
export type DocumentSummary = { id: string; projectId: string; title: string; revision: number };
export type WorkspaceSelection = { projectId: string; documentId: string };
export type SuggestionProjection = { state: PersistedSuggestionState; revision: number };
export type SuggestionCommandResult = OperationResult<
  typeof StorageOperations,
  "suggestions.command"
>;

export interface TransactionManager {
  run<T>(operation: () => T): T;
}

export interface ProjectStore {
  list?(): ProjectSnapshot[];
  get(id: string): ProjectSnapshot;
  create?(id: string, name: string, now: number): ProjectSnapshot;
  rename?(id: string, name: string, now: number): ProjectSnapshot;
  delete?(id: string): void;
  incrementRevision(id: string, updatedAt: number): void;
}

export interface DocumentStore {
  list?(projectId?: string): DocumentSummary[];
  get(projectIdOrId: string, id?: string): DocumentSnapshot;
  create?(projectId: string, id: string, title: string, now: number): DocumentSnapshot;
  rename?(projectId: string, id: string, title: string, now: number): DocumentSnapshot;
  delete?(projectId: string, id: string): void;
  count?(projectId: string): number;
  save(...args: unknown[]): DocumentSnapshot;
}

export interface SourceStore {
  list(projectId: string, documentId?: string): SourceSnapshot[];
  insert(source: SourceSnapshot, createdAt: number): void;
  get(projectIdOrId: string, documentId?: string, id?: string): SourceSnapshot;
}

export interface SuggestionStore {
  get(projectId: string, documentId?: string): SuggestionProjection;
  compareAndPut(
    projectId: string,
    documentIdOrExpectedRevision: string | number, expectedRevisionOrState: number | PersistedSuggestionState,
    state?: PersistedSuggestionState,
  ): SuggestionProjection;
  findReceipt(projectIdOrCommandId: string, documentId?: string, commandId?: string): SuggestionCommandResult | undefined;
  recordReceipt(projectId: string, documentIdOrResult: string | SuggestionCommandResult, result?: SuggestionCommandResult): void;
}

export interface SelectionStore {
  resolve(): WorkspaceSelection;
  set(projectId: string, documentId: string, now: number): WorkspaceSelection;
}

export interface EventOutbox {
  enqueue(projectIdOrEvent: string | DurableEventPayload, documentIdOrCausation?: string, event?: DurableEventPayload, causationId?: string): DurableEventEnvelope;
  pending(): DurableEventEnvelope[];
  markDispatched(eventId: string): void;
  replay(streamId: string, afterSequence: number, limit?: number): {
    streamId: string;
    events: DurableEventEnvelope[];
    headSequence: number;
    hasMore: boolean;
    historyAvailable: boolean;
  };
  head(streamId: string): number;
  acknowledge(consumerId: string, streamId: string, sequence: number): number;
}

export interface EventDispatcher {
  dispatch(): Promise<void>;
}

export type CopiedSource = { filename: string; destination: string; bytes: number };
export interface WorkspaceFiles {
  writeDraft(markdown: string): Promise<void>;
  repairDraft(markdown: string): Promise<{ repaired: boolean }>;
  copySource(sourcePath: string): Promise<CopiedSource>;
  removeSource(path: string): Promise<void>;
  removeWorkspace?(): Promise<void>;
}

export interface WorkspaceFilesFactory {
  forDocument(projectId: string, documentId: string): { descriptor: WorkspaceDescriptor; files: WorkspaceFiles };
}

export interface Clock {
  now(): number;
}

export interface IdentityGenerator {
  next(): string;
}

export type WorkspaceDescriptor = {
  workspaceRoot: string;
  draftPath: string;
  sourcesDirectory: string;
  piDirectory: string;
};
