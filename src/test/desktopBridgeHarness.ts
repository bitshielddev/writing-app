import type {
  AgentRuntime,
  DesktopBridge,
  DesktopEvent,
  DesktopTransportEvent,
  DocumentSnapshot,
  SourceSnapshot,
  WorkspaceSnapshot,
} from "../shared/desktop";
import { createEmptySuggestionState } from "../suggestions/state";

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

export class ControlledOperation<Args extends unknown[], Result> {
  readonly calls: Array<{ args: Args; completion: Deferred<Result> }> = [];

  readonly invoke = (...args: Args): Promise<Result> => {
    const completion = deferred<Result>();
    this.calls.push({ args, completion });
    return completion.promise;
  };

  resolve(index: number, result: Result) {
    const call = this.calls[index];
    if (!call) throw new Error(`No controlled call at index ${index}`);
    call.completion.resolve(result);
  }

  reject(index: number, error: unknown) {
    const call = this.calls[index];
    if (!call) throw new Error(`No controlled call at index ${index}`);
    call.completion.reject(error);
  }
}

export function createDocumentSnapshot(
  overrides: Partial<DocumentSnapshot> = {},
): DocumentSnapshot {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Draft",
    blocks: [{ id: "block-1", type: "paragraph", content: "Opening" }],
    markdown: "Opening\n",
    schemaVersion: 1,
    revision: 3,
    updatedAt: 1,
    ...overrides,
  };
}

export function createSourceSnapshot(
  overrides: Partial<SourceSnapshot> = {},
): SourceSnapshot {
  return {
    id: "source-1",
    projectId: "project-1",
    documentId: "document-1",
    title: "Research.md",
    storagePath: "/workspace/sources/Research.md",
    bytes: 128,
    updatedAt: 1,
    ...overrides,
  };
}

export function createWorkspaceSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    streamId: "document:default-document",
    coveredThroughSequence: 0,
    project: { id: "project-1", name: "Writing project", revision: 5 },
    document: createDocumentSnapshot(),
    sources: [createSourceSnapshot()],
    suggestions: createEmptySuggestionState(),
    suggestionRevision: 0,
    agent: { status: "stopped", cycleCount: 2 },
    activity: [],
    health: {
      storage: { state: "healthy", since: 1 },
      agent: { state: "healthy", since: 1 },
    },
    ...overrides,
  };
}

export class DesktopBridgeHarness {
  readonly hydrate = new ControlledOperation<[], WorkspaceSnapshot>();
  readonly startAgent = new ControlledOperation<[], AgentRuntime>();
  readonly stopAgent = new ControlledOperation<[], AgentRuntime>();
  readonly saveDocument = new ControlledOperation<
    [Parameters<DesktopBridge["saveDocument"]>[0]],
    DocumentSnapshot
  >();
  readonly executeSuggestionCommand = new ControlledOperation<
    [Parameters<DesktopBridge["executeSuggestionCommand"]>[0]],
    Awaited<ReturnType<DesktopBridge["executeSuggestionCommand"]>>
  >();
  readonly importSource = new ControlledOperation<[], SourceSnapshot | undefined>();
  private readonly listeners = new Set<(event: DesktopTransportEvent) => void>();

  readonly bridge: DesktopBridge = {
    getWorkspaceCatalog: async () => ({
      projects: [{ id: "project-1", name: "Writing project", revision: 5 }],
      documents: [{ id: "document-1", projectId: "project-1", title: "Draft", revision: 3 }],
      selection: { projectId: "project-1", documentId: "document-1" },
    }),
    createProject: async () => this.bridge.getWorkspaceCatalog(),
    renameProject: async () => this.bridge.getWorkspaceCatalog(),
    deleteProject: async () => this.bridge.getWorkspaceCatalog(),
    selectProject: async () => this.bridge.getWorkspaceCatalog(),
    createDocument: async () => this.bridge.getWorkspaceCatalog(),
    renameDocument: async () => this.bridge.getWorkspaceCatalog(),
    deleteDocument: async () => this.bridge.getWorkspaceCatalog(),
    selectDocument: async () => this.bridge.getWorkspaceCatalog(),
    hydrate: () => this.hydrate.invoke(),
    startAgent: () => this.startAgent.invoke(),
    stopAgent: () => this.stopAgent.invoke(),
    saveDocument: this.saveDocument.invoke,
    executeSuggestionCommand: this.executeSuggestionCommand.invoke,
    importSource: () => this.importSource.invoke(),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  get listenerCount() {
    return this.listeners.size;
  }

  emit(event: DesktopEvent) {
    for (const listener of this.listeners) listener(event as DesktopTransportEvent);
  }
}
