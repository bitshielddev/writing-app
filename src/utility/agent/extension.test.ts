// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createScribeExtension,
  executeSuggestionMutation,
  type ScribeExtensionHost,
} from "./extension";
import { ScribeLoopState } from "./domain/loop";
import { RemoteContractError } from "../../contracts/validation";

/**
 * What: performs the host step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by extension when that path needs this behavior.
 */
function host(
  storageCall: ScribeExtensionHost["storageCall"] = async <T>() =>
    ({ accepted: true }) as T,
) {
  return {
    loop: new ScribeLoopState(),
    storageCall,
    runtime: vi.fn(),
    activity: vi.fn(),
    wake: vi.fn(),
    persist: vi.fn(),
  } satisfies ScribeExtensionHost;
}

/**
 * What: performs the successful storage step for this file's workflow.
 *
 * Why: the test needs a focused helper so assertions stay about the behavior under test.
 * Called when: used by extension when that path needs this behavior.
 */
function successfulStorage() {
  const calls = vi.fn();
  /**
   * What: performs the storage call step for this file's workflow.
   *
   * Why: the test needs a focused helper so assertions stay about the behavior under test.
   * Called when: used by successfulStorage when that path needs this behavior.
   */
  const storageCall: ScribeExtensionHost["storageCall"] = async <T>(
    method: string,
    params?: unknown,
  ) => {
    calls(method, params);
    if (method === "agent.seed") {
      return {
        streamId: "document:document",
        coveredThroughSequence: 1,
        projectId: "project",
        projectName: "Project",
        projectRevision: 4,
        documentId: "document",
        documentTitle: "Draft",
        documentRevision: 7,
      } as T;
    }
    return { accepted: true } as T;
  };
  return { calls, storageCall };
}

describe("suggestion tool mutation helper", () => {
  it("rejects mutations without an active revision", async () => {
    const { calls, storageCall } = successfulStorage();
    const extensionHost = host(storageCall);
    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.retract",
      { id: "suggestion" },
    );

    expect(result).toMatchObject({ details: "No active revision", isError: true });
    expect(calls).not.toHaveBeenCalled();
    expect(extensionHost.wake).not.toHaveBeenCalled();
  });

  it("adds the active revision to storage mutations", async () => {
    const { calls, storageCall } = successfulStorage();
    const extensionHost = host(storageCall);
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();

    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.retract",
      { id: "suggestion" },
    );

    expect(calls).toHaveBeenNthCalledWith(1, "agent.seed", {});
    expect(calls).toHaveBeenNthCalledWith(2, "agent.suggestion.retract", {
      id: "suggestion",
      expectedDocumentRevision: 7,
    });
    expect(result).toMatchObject({ details: { accepted: true }, isError: false });
  });

  it("refreshes and rejects before mutating when the document revision changed", async () => {
    const calls = vi.fn();
    const extensionHost = host(async <T>(method: string, params?: unknown): Promise<T> => {
      calls(method, params);
      if (method === "agent.seed") {
        return {
          streamId: "document:document",
          coveredThroughSequence: 2,
          projectId: "project",
          projectName: "Project",
          projectRevision: 5,
          documentId: "document",
          documentTitle: "Draft",
          documentRevision: 8,
        } as T;
      }
      return { accepted: true } as T;
    });
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();
    extensionHost.documentReadRevision = 7;

    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.update",
      { item: {} },
    );

    expect(result).toMatchObject({
      details: "The document changed since this agent cycle began. End this response now; Scribe will restart on the current revision.",
      isError: true,
    });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(extensionHost.documentReadRevision).toBeUndefined();
    expect(extensionHost.persist).toHaveBeenCalledOnce();
    expect(extensionHost.runtime).toHaveBeenCalledOnce();
    expect(extensionHost.wake).toHaveBeenCalledOnce();
  });

  it("refreshes and clears stale reads when storage detects a revision race", async () => {
    const calls = vi.fn();
    const extensionHost = host(async <T>(method: string, params?: unknown): Promise<T> => {
      calls(method, params);
      if (method === "agent.seed") {
        const seedRevision = calls.mock.calls.length === 1 ? 7 : 8;
        return {
          streamId: "document:document",
          coveredThroughSequence: seedRevision,
          projectId: "project",
          projectName: "Project",
          projectRevision: seedRevision === 7 ? 4 : 5,
          documentId: "document",
          documentTitle: "Draft",
          documentRevision: seedRevision,
        } as T;
      }
      throw new RemoteContractError({
        code: "STALE_SUGGESTION_REVISION",
        message: "The suggestion targets an older document revision",
        retryable: true,
      });
    });
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();
    extensionHost.documentReadRevision = 7;

    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.update",
      { item: {} },
    );

    expect(result).toMatchObject({
      details: "The document changed since this agent cycle began. End this response now; Scribe will restart on the current revision.",
      isError: true,
    });
    expect(calls.mock.calls.map((call) => call[0])).toEqual([
      "agent.seed",
      "agent.suggestion.update",
      "agent.seed",
    ]);
    expect(extensionHost.documentReadRevision).toBeUndefined();
    expect(extensionHost.wake).toHaveBeenCalledOnce();
  });

  it("requires reading the active document before creating or updating suggestions", async () => {
    const { calls, storageCall } = successfulStorage();
    const extensionHost = host(storageCall);
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();

    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.create",
      { item: {} },
    );

    expect(result).toMatchObject({
      details: "Read the current document revision with read_document before creating or updating suggestions.",
      isError: true,
    });
    expect(calls).toHaveBeenCalledOnce();
    expect(calls).toHaveBeenCalledWith("agent.seed", {});
  });
});

describe("scribe extension document tool", () => {
  it("reads the active persisted document through storage", async () => {
    const { calls, storageCall } = successfulStorage();
    const extensionHost = host(storageCall);
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();
    const registered = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
    const pi = {
      on: vi.fn(),
      events: { on: vi.fn() },
      setSessionName: vi.fn(),
      registerTool: vi.fn((tool: { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }) => {
        registered.set(tool.name, tool);
      }),
    };

    createScribeExtension(extensionHost)(pi as never);
    const result = await registered.get("read_document")!.execute("tool-call", {});

    expect(calls).toHaveBeenCalledWith("agent.document.read", {});
    expect(extensionHost.documentReadRevision).toBe(7);
    expect(result).toMatchObject({ details: { accepted: true }, isError: false });
  });

  it("rejects document reads without an active revision", async () => {
    const { calls, storageCall } = successfulStorage();
    const extensionHost = host(storageCall);
    const registered = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
    const pi = {
      on: vi.fn(),
      events: { on: vi.fn() },
      setSessionName: vi.fn(),
      registerTool: vi.fn((tool: { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }) => {
        registered.set(tool.name, tool);
      }),
    };

    createScribeExtension(extensionHost)(pi as never);
    const result = await registered.get("read_document")!.execute("tool-call", {});

    expect(result).toMatchObject({ details: "No active revision", isError: true });
    expect(calls).not.toHaveBeenCalled();
  });
});
