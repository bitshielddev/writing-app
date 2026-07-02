import type { SuggestionEvent, SuggestionItem } from "../suggestions/types";
import type { PersistedSuggestionState } from "../suggestions/state";

export type { PersistedSuggestionState } from "../suggestions/state";

export type AgentStatus =
  | "offline"
  | "stopped"
  | "working"
  | "waiting"
  | "capped"
  | "error";

export type AgentRuntime = {
  status: AgentStatus;
  sessionId?: string;
  activeRevision?: number;
  cycleCount: number;
  error?: string;
};

export type AgentActivityKind =
  | "lifecycle"
  | "message"
  | "reasoning"
  | "tool"
  | "provider"
  | "loop"
  | "error";

export type AgentActivity = {
  id: string;
  kind: AgentActivityKind;
  timestamp: number;
  updatedAt: number;
  title: string;
  text?: string;
  payload?: unknown;
  status?: AgentStatus;
};

export type DocumentSnapshot = {
  id: string;
  projectId: string;
  title: string;
  blocks: unknown[];
  markdown: string;
  schemaVersion: number;
  revision: number;
  updatedAt: number;
};

export type SourceSnapshot = {
  id: string;
  projectId: string;
  title: string;
  storagePath: string;
  bytes: number;
  updatedAt: number;
};

export type WorkspaceSnapshot = {
  project: { id: string; name: string; revision: number };
  document: DocumentSnapshot;
  sources: SourceSnapshot[];
  suggestions: PersistedSuggestionState;
  agent: AgentRuntime;
  activity: AgentActivity[];
};

export type DesktopEvent =
  | { type: "suggestion.event"; event: SuggestionEvent }
  | { type: "agent.runtime"; runtime: AgentRuntime }
  | { type: "agent.activity"; activity: AgentActivity }
  | { type: "document.saved"; document: DocumentSnapshot; projectRevision: number }
  | { type: "source.imported"; source: SourceSnapshot; projectRevision: number };

export type DesktopBridge = {
  hydrate(): Promise<WorkspaceSnapshot>;
  startAgent(): Promise<AgentRuntime>;
  stopAgent(): Promise<AgentRuntime>;
  saveDocument(input: {
    documentId: string;
    blocks: unknown[];
    markdown: string;
    expectedRevision: number;
  }): Promise<DocumentSnapshot>;
  saveSuggestionState(state: PersistedSuggestionState): Promise<void>;
  importSource(): Promise<SourceSnapshot | undefined>;
  subscribe(listener: (event: DesktopEvent) => void): () => void;
};

export type DesktopDevelopmentBridge = {
  createSuggestion(item: SuggestionItem): Promise<{ accepted: boolean }>;
};

export type ObservationSeed = {
  projectId: string;
  projectName: string;
  projectRevision: number;
  documentId: string;
  documentTitle: string;
  documentRevision: number;
};
