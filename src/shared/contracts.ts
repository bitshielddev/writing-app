import type {
  AgentActivity,
  AgentRuntime,
  DesktopBridge,
  DesktopEvent,
} from "./desktop";

export const DESKTOP_INVOKE_CHANNELS = {
  hydrate: "scribe:hydrate",
  startAgent: "scribe:agent.start",
  stopAgent: "scribe:agent.stop",
  saveDocument: "scribe:document.save",
  saveSuggestionState: "scribe:suggestions.save",
  importSource: "scribe:source.import",
} as const satisfies Record<Exclude<keyof DesktopBridge, "subscribe">, string>;

export const DESKTOP_EVENT_CHANNEL = "scribe:event" as const;
export const DEVELOPMENT_SUGGESTION_CHANNEL =
  "scribe:development.suggestion.create" as const;

export const STORAGE_RPC_METHODS = [
  "hydrate",
  "workspace.repair",
  "document.save",
  "suggestions.save",
  "source.import",
  "agent.seed",
  "agent.suggestions.list",
  "agent.suggestion.create",
  "agent.suggestion.update",
  "agent.suggestion.retract",
  "development.suggestion.create",
] as const;

export type StorageRpcMethod = (typeof STORAGE_RPC_METHODS)[number];

export const AGENT_RPC_METHODS = ["agent.start", "agent.stop"] as const;
export type AgentRpcMethod = (typeof AGENT_RPC_METHODS)[number];

export const DESKTOP_EVENT_TYPES = {
  "suggestion.event": true,
  "agent.runtime": true,
  "agent.activity": true,
  "document.saved": true,
  "source.imported": true,
} as const satisfies Record<DesktopEvent["type"], true>;

export type RpcRequest = {
  kind: "rpc";
  id: string;
  method: string;
  params?: unknown;
};

export type RpcResult = {
  kind: "rpc.result";
  id: string;
  result?: unknown;
  error?: string;
};

export type ChildMessage =
  | { kind: "ready" }
  | RpcResult
  | { kind: "domain.event"; event: DesktopEvent }
  | { kind: "storage.request"; id: string; method: string; params?: unknown }
  | { kind: "agent.runtime"; runtime: Partial<AgentRuntime> }
  | { kind: "agent.activity"; activity: Omit<AgentActivity, "updatedAt"> };

export const CHILD_MESSAGE_KINDS = {
  ready: true,
  "rpc.result": true,
  "domain.event": true,
  "storage.request": true,
  "agent.runtime": true,
  "agent.activity": true,
} as const satisfies Record<ChildMessage["kind"], true>;

export type AgentParentMessage =
  | { kind: "project.changed"; projectRevision: number; documentRevision: number }
  | { kind: "rpc"; id: string; method: AgentRpcMethod; params?: unknown }
  | { kind: "storage.result"; id: string; result?: unknown; error?: string }
  | { kind: "shutdown" };

export const AGENT_PARENT_MESSAGE_KINDS = {
  "project.changed": true,
  rpc: true,
  "storage.result": true,
  shutdown: true,
} as const satisfies Record<AgentParentMessage["kind"], true>;
