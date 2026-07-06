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
export type SuggestionProjection = { state: PersistedSuggestionState; revision: number };
export type SuggestionCommandResult = OperationResult<
  typeof StorageOperations,
  "suggestions.command"
>;

export interface TransactionManager {
  run<T>(operation: () => T): T;
}

export interface ProjectStore {
  get(id: string): ProjectSnapshot;
  incrementRevision(id: string, updatedAt: number): void;
}

export interface DocumentStore {
  get(id: string): DocumentSnapshot;
  save(id: string, blocks: unknown[], markdown: string, updatedAt: number): DocumentSnapshot;
}

export interface SourceStore {
  list(projectId: string): SourceSnapshot[];
  insert(source: SourceSnapshot, createdAt: number): void;
  get(id: string): SourceSnapshot;
}

export interface SuggestionStore {
  get(projectId: string): SuggestionProjection;
  compareAndPut(
    projectId: string,
    expectedRevision: number,
    state: PersistedSuggestionState,
  ): SuggestionProjection;
  findReceipt(commandId: string): SuggestionCommandResult | undefined;
  recordReceipt(projectId: string, result: SuggestionCommandResult): void;
}

export interface EventOutbox {
  enqueue(event: DurableEventPayload, causationId?: string): DurableEventEnvelope;
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
