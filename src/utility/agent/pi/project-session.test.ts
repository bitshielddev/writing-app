// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AuthStorage,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
  createScribeExtension,
  encodeScribeLoopEntry,
  restoreScribeLoopEntry,
  SCRIBE_LOOP_ENTRY,
  SCRIBE_REVISION_EVENT,
  SCRIBE_TOOL_NAMES,
  type ScribeExtensionHost,
} from "../extension";
import { ScribeLoopState } from "../domain/loop";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Pi project session", () => {
  it("continues the project session and restores extension entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "scribe-pi-session-"));
    directories.push(root);
    const sessionDir = join(root, ".pi", "sessions");
    const first = SessionManager.continueRecent(root, sessionDir);
    first.appendMessage({ role: "user", content: "review revision 9", timestamp: Date.now() });
    first.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "reviewed" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    first.appendCustomEntry(SCRIBE_LOOP_ENTRY, { yieldedRevision: 9, status: "waiting" });

    const continued = SessionManager.continueRecent(root, sessionDir);
    expect(continued.getSessionId()).toBe(first.getSessionId());
    expect(continued.getEntries().at(-1)).toMatchObject({
      type: "custom",
      customType: SCRIBE_LOOP_ENTRY,
      data: { yieldedRevision: 9, status: "waiting" },
    });
  });

  it("versions Scribe entries, reads legacy entries, and disables newer resume", () => {
    const current = encodeScribeLoopEntry(new ScribeLoopState({
      yieldedRevision: 9,
      status: "waiting",
    }));
    expect(current).toMatchObject({ type: SCRIBE_LOOP_ENTRY, version: 1 });
    expect(restoreScribeLoopEntry(current).state?.snapshot()).toMatchObject({
      yieldedRevision: 9,
      status: "stopped",
    });
    expect(restoreScribeLoopEntry({
      latestRevision: 8,
      latestDocumentRevision: 8,
      yieldedRevision: 8,
      cycleCount: 0,
      status: "waiting",
    })
      .state?.snapshot()).toMatchObject({ yieldedRevision: 8 });
    expect(restoreScribeLoopEntry({
      type: SCRIBE_LOOP_ENTRY,
      version: 99,
      payload: { yieldedRevision: 10, status: "waiting" },
    })).toEqual({ unsupportedVersion: 99 });
  });

  it("activates only four read tools plus Scribe tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "scribe-pi-tools-"));
    directories.push(root);
    const settings = SettingsManager.inMemory({}, { projectTrusted: true });
    const auth = AuthStorage.inMemory();
    const registry = ModelRegistry.inMemory(auth);
    const bus = createEventBus();
    const reportRuntime = vi.fn();
    const wake = vi.fn();
    const host: ScribeExtensionHost = {
      loop: new ScribeLoopState(),
      storageCall: async <T>() => ({}) as T,
      runtime: reportRuntime,
      activity: () => undefined,
      wake,
      persist: () => undefined,
    };
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "pi"),
      settingsManager: settings,
      eventBus: bus,
      extensionFactories: [createScribeExtension(host)],
      noExtensions: true,
    });
    await loader.reload({ resolveProjectTrust: async () => true });
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "pi"),
      authStorage: auth,
      modelRegistry: registry,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(root),
      tools: ["read", "grep", "find", "ls", ...SCRIBE_TOOL_NAMES],
      excludeTools: ["bash", "write", "edit"],
    });
    const active = session.getActiveToolNames();
    expect(active).toEqual(expect.arrayContaining(["read", "grep", "find", "ls"]));
    expect(active).not.toEqual(expect.arrayContaining(["bash", "write", "edit"]));
    expect(active).toHaveLength(4 + SCRIBE_TOOL_NAMES.length);
    bus.emit(SCRIBE_REVISION_EVENT, {
      projectRevision: 2,
      documentRevision: 1,
    });
    expect(reportRuntime).toHaveBeenCalledWith();
    expect(wake).toHaveBeenCalledOnce();
    session.dispose();
  });
});
