import { describe, expect, it, vi } from "vitest";

import { deferred } from "../src/test/desktopBridgeHarness";
import {
  databaseStartupGuidance,
  runDesktopStartup,
  startDesktop,
  type DesktopProcess,
} from "./startup";
import { ChildStartupError } from "./child-rpc";
import { AgentOperations, StorageOperations } from "../src/shared/contracts";

function processHarness(ready: Promise<void>, calls: string[], name: string) {
  return {
    ready,
    call: vi.fn(async (method: string) => {
      calls.push(`${name}.call:${method}`);
      if (method === "agent.seed") {
        return { projectRevision: 7, documentRevision: 3 };
      }
      return undefined;
    }),
    post: vi.fn((message: unknown) => {
      calls.push(`${name}.post:${(message as { kind: string }).kind}`);
    }),
    kill: vi.fn(),
  } as unknown as DesktopProcess<typeof StorageOperations> & DesktopProcess<typeof AgentOperations>;
}

describe("desktop startup", () => {
  it("orders readiness, repair, IPC, window creation, and initial revision", async () => {
    const calls: string[] = [];
    const storageReady = deferred<void>();
    const agentReady = deferred<void>();
    const storage = processHarness(storageReady.promise, calls, "storage");
    const agent = processHarness(agentReady.promise, calls, "agent");
    const started = startDesktop({
      spawnStorage: () => {
        calls.push("spawn.storage");
        return storage;
      },
      spawnAgent: () => {
        calls.push("spawn.agent");
        return agent;
      },
      registerIpc: () => calls.push("register.ipc"),
      installMenu: () => calls.push("install.menu"),
      createWindow: () => calls.push("create.window"),
    });

    await Promise.resolve();
    expect(calls).toEqual(["spawn.storage"]);
    storageReady.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      "spawn.storage",
      "storage.call:workspace.repair",
      "spawn.agent",
    ]);
    agentReady.resolve();
    await started;

    expect(calls).toEqual([
      "spawn.storage",
      "storage.call:workspace.repair",
      "spawn.agent",
      "register.ipc",
      "install.menu",
      "create.window",
      "storage.call:agent.seed",
      "agent.post:project.changed",
    ]);
    expect(agent.post).toHaveBeenCalledWith({
      kind: "project.changed",
      protocolVersion: 1,
      streamId: "document:default-document",
      sequence: 0,
      projectRevision: 7,
      documentRevision: 3,
    });
  });

  it("reports startup failure through the existing quit policy hook", async () => {
    const failure = new Error("storage unavailable");
    const onFailure = vi.fn();
    await runDesktopStartup(async () => Promise.reject(failure), onFailure);
    expect(onFailure).toHaveBeenCalledWith(failure);
  });

  it("formats actionable database recovery guidance with the affected path", () => {
    const guidance = databaseStartupGuidance(new ChildStartupError(
      "DATABASE_MIGRATION_FAILED",
      "Migration add-index failed",
      "/data/scribe.sqlite3",
    ));
    expect(guidance).toContain("Migration add-index failed");
    expect(guidance).toContain("/data/scribe.sqlite3");
    expect(guidance).toContain("was not reset");
  });
});
