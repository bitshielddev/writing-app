import type { SuggestionEvent, SuggestionItem } from "../suggestions/types";

export type PersistedInboxEntry = {
  item: SuggestionItem;
  viewed: boolean;
  stale: boolean;
  withdrawn: boolean;
};

export type PersistedPinnedEntry = PersistedInboxEntry & {
  pinnedAt: number;
};

export type PersistedWorkspacePin = {
  item: SuggestionItem;
  pinnedAt: number;
  pendingInitialPlacement: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

export type PersistedSuggestionState = {
  entries: PersistedInboxEntry[];
  pinnedEntries: PersistedPinnedEntry[];
  workspacePins: PersistedWorkspacePin[];
  seenKeys: Record<string, true>;
  nextZIndex: number;
};

export type ProviderSettings = {
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
};

export type AgentRuntime = {
  paused: boolean;
  running: boolean;
  configured: boolean;
  lastCompletedAt?: number;
  lastError?: string;
};

export type DocumentSnapshot = {
  id: string;
  projectId: string;
  title: string;
  blocks: unknown[];
  schemaVersion: number;
  revision: number;
  updatedAt: number;
};

export type SourceSnapshot = {
  id: string;
  projectId: string;
  title: string;
  storagePath: string;
  extractedCharacters: number;
  updatedAt: number;
};

export type WorkspaceSnapshot = {
  project: { id: string; name: string; revision: number };
  document: DocumentSnapshot;
  sources: SourceSnapshot[];
  suggestions: PersistedSuggestionState;
  provider: ProviderSettings;
  agent: AgentRuntime;
  sequence: number;
};

export type DesktopEvent =
  | { type: "suggestion.event"; sequence: number; event: SuggestionEvent }
  | { type: "agent.runtime"; runtime: AgentRuntime }
  | { type: "document.saved"; document: DocumentSnapshot }
  | { type: "source.imported"; source: SourceSnapshot };

export type DesktopBridge = {
  hydrate(): Promise<WorkspaceSnapshot>;
  saveDocument(input: {
    documentId: string;
    blocks: unknown[];
    expectedRevision: number;
  }): Promise<DocumentSnapshot>;
  saveSuggestionState(state: PersistedSuggestionState): Promise<void>;
  importSource(): Promise<SourceSnapshot | undefined>;
  setProvider(input: ProviderSettings & { apiKey: string }): Promise<ProviderSettings>;
  setAgentPaused(paused: boolean): Promise<AgentRuntime>;
  considerNow(): Promise<void>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
};

export type ProjectContentItem = {
  id: string;
  type: "document" | "source";
  title: string;
  updatedAt: number;
};

export type ObservationSeed = {
  projectId: string;
  projectName: string;
  projectRevision: number;
  documentId: string;
  documentTitle: string;
  documentRevision: number;
  memorySummary: string;
  provider: ProviderSettings;
  paused: boolean;
};
