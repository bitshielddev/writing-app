// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  executeSuggestionMutation,
  type ScribeExtensionHost,
} from "./scribe-extension";
import { ScribeLoopState } from "./scribe-loop";

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

function successfulStorage() {
  const calls = vi.fn();
  const storageCall: ScribeExtensionHost["storageCall"] = async <T>(
    method: string,
    params?: unknown,
  ) => {
    calls(method, params);
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

    expect(calls).toHaveBeenCalledWith("agent.suggestion.retract", {
      id: "suggestion",
      expectedDocumentRevision: 7,
    });
    expect(result).toMatchObject({ details: { accepted: true }, isError: false });
  });

  it("returns storage errors and wakes the loop for a newer revision", async () => {
    const extensionHost = host(async <T>(): Promise<T> => {
      throw new Error("STALE_SUGGESTION_REVISION");
    });
    extensionHost.loop.revision(4, 7);
    extensionHost.loop.start();
    extensionHost.loop.beginCycle();

    const result = await executeSuggestionMutation(
      extensionHost,
      "agent.suggestion.update",
      { item: {} },
    );

    expect(result).toMatchObject({
      details: "STALE_SUGGESTION_REVISION",
      isError: true,
    });
    expect(extensionHost.wake).toHaveBeenCalledOnce();
  });
});
