import type {
  AgentRuntime,
  DesktopBridge,
  DesktopEvent,
  DesktopTransportEvent,
  DocumentSaveReceipt,
  DocumentSnapshot,
  SourceSnapshot,
  WorkspaceSnapshot,
  ThemeCatalog,
} from "../contracts/desktop-bridge";
import { createEmptySuggestionState } from "../domain/suggestions/state";

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

/**
 * What: performs the deferred step for this file's workflow.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by desktopBridgeHarness, startup, useSuggestionController and durableEventCoordinator when that path needs this behavior.
 */
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

  /**
   * What: performs the invoke step for this file's workflow.
   *
   * Why: callers need this behavior in one named place instead of duplicating it.
   * Called when: used by desktopBridgeHarness when that path needs this behavior.
   */
  readonly invoke = (...args: Args): Promise<Result> => {
    const completion = deferred<Result>();
    this.calls.push({ args, completion });
    return completion.promise;
  };

  /**
   * What: performs the resolve step for this file's workflow.
   *
   * Why: callers need this behavior in one named place instead of duplicating it.
   * Called when: used by App, useDocumentAutosave, useWorkspaceHydration and workspaceServices when that path needs this behavior.
   */
  resolve(index: number, result: Result) {
    const call = this.calls[index];
    if (!call) throw new Error(`No controlled call at index ${index}`);
    call.completion.resolve(result);
  }

  /**
   * What: performs the reject step for this file's workflow.
   *
   * Why: callers need this behavior in one named place instead of duplicating it.
   * Called when: used by App, useDocumentAutosave, useWorkspaceHydration and workspaceServices when that path needs this behavior.
   */
  reject(index: number, error: unknown) {
    const call = this.calls[index];
    if (!call) throw new Error(`No controlled call at index ${index}`);
    call.completion.reject(error);
  }
}

/**
 * What: creates document snapshot with the dependencies and defaults this workflow expects.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by createWorkspaceSnapshot, contracts, durable-event-broker and envelope when that path needs this behavior.
 */
export function createDocumentSnapshot(
  overrides: Partial<DocumentSnapshot> = {},
): DocumentSnapshot {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Draft",
    blocks: [{ id: "block-1", type: "paragraph", content: "Opening" }],
    schemaVersion: 1,
    revision: 3,
    updatedAt: 1,
    ...overrides,
  };
}

export function createDocumentSaveReceipt(
  overrides: Partial<DocumentSaveReceipt> = {},
): DocumentSaveReceipt {
  return {
    projectId: "project-1",
    documentId: "document-1",
    documentRevision: 3,
    projectRevision: 5,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * What: creates source snapshot with the dependencies and defaults this workflow expects.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by createWorkspaceSnapshot, contracts, routing and createHarness when that path needs this behavior.
 */
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

export function createThemeCatalog(): ThemeCatalog {
  return {
    activeThemeId: "scribe-light",
    themes: [{
      id: "scribe-light", schema_version: 1, display_name: "Scribe Light", appearance: "light",
      colors: {
        background: "#ffffff", foreground: "#1a1b22", panel: "#f4f2fd", panel_foreground: "#1a1b22",
        surface: "#fbfaff", surface_foreground: "#1a1b22", surface_raised: "#ffffff", muted: "#e8e7f1",
        muted_foreground: "#686577", border: "#d7d4e8", primary: "#5748e5", primary_hover: "#4434c9",
        primary_foreground: "#ffffff", accent: "#eceaff", accent_foreground: "#1a1b22", focus: "#5748e5",
        overlay: "#00000099", success: "#238636", success_foreground: "#ffffff", warning: "#9a6700",
        warning_foreground: "#ffffff", danger: "#cf222e", danger_foreground: "#ffffff", pin: "#ffffff",
        pin_header: "#5748e5", pin_foreground: "#1a1b22", pin_border: "#d7d4e8",
      },
    }],
  };
}

/**
 * What: creates workspace snapshot with the dependencies and defaults this workflow expects.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by contracts, routing, createHarness and bridge when that path needs this behavior.
 */
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
    DocumentSaveReceipt
  >();
  readonly executeSuggestionCommand = new ControlledOperation<
    [Parameters<DesktopBridge["executeSuggestionCommand"]>[0]],
    Awaited<ReturnType<DesktopBridge["executeSuggestionCommand"]>>
  >();
  readonly importSource = new ControlledOperation<[], SourceSnapshot | undefined>();
  private readonly listeners = new Set<(event: DesktopTransportEvent) => void>();

  readonly bridge: DesktopBridge = {
    getThemeCatalog: async () => createThemeCatalog(),
    selectTheme: async () => createThemeCatalog(),
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

  /**
   * What: performs the emit step for this file's workflow.
   *
   * Why: callers need this behavior in one named place instead of duplicating it.
   * Called when: used by App when that path needs this behavior.
   */
  emit(event: DesktopEvent) {
    for (const listener of this.listeners) listener(event as DesktopTransportEvent);
  }
}
