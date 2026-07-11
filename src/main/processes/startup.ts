import {
  DEFAULT_EVENT_STREAM_ID,
  PROTOCOL_VERSION,
  type OperationCaller,
  type OperationRegistry,
} from "../../contracts/base.js";
import { AgentOperations } from "../../contracts/operations/agent.js";
import { StorageOperations } from "../../contracts/operations/storage.js";
import { ChildStartupError } from "./child-rpc.js";

export type DesktopProcess<Registry extends OperationRegistry> = OperationCaller<Registry> & {
  ready: Promise<void>;
  post(message: unknown): void;
  kill(): void;
};

/**
 * What: starts desktop and wires the dependencies it needs.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by startup when that path needs this behavior.
 */
export async function startDesktop({
  spawnStorage,
  spawnAgent,
  registerIpc,
  installMenu,
  createWindow,
}: {
  spawnStorage: () => DesktopProcess<typeof StorageOperations>;
  spawnAgent: (scope?: { projectId: string; documentId: string }) => DesktopProcess<typeof AgentOperations>;
  registerIpc: (
    storage: DesktopProcess<typeof StorageOperations>,
    agent: DesktopProcess<typeof AgentOperations>,
  ) => void;
  installMenu: () => void;
  createWindow: () => void;
}) {
  const storage = spawnStorage();
  await storage.ready;
  const catalog = await storage.call("workspace.catalog");

  const agent = spawnAgent(catalog.selection);
  await agent.ready;

  registerIpc(storage, agent);
  installMenu();
  createWindow();

  const seed = await storage.call("agent.seed", catalog.selection);
  agent.post({
    kind: "project.changed",
    protocolVersion: PROTOCOL_VERSION,
    streamId: seed.streamId ?? DEFAULT_EVENT_STREAM_ID,
    sequence: seed.coveredThroughSequence ?? 0,
    projectRevision: seed.projectRevision,
    documentRevision: seed.documentRevision,
  });
  return { storage, agent };
}

/**
 * What: runs desktop startup as a complete operation.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by index and startup when that path needs this behavior.
 */
export async function runDesktopStartup(
  start: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
) {
  try {
    await start();
  } catch (error) {
    onFailure(error);
  }
}

/**
 * What: performs the database startup guidance step for this file's workflow.
 *
 * Why: desktop child-process lifecycle and RPC behavior need one predictable implementation.
 * Called when: used by index and startup when that path needs this behavior.
 */
export function databaseStartupGuidance(error: unknown) {
  if (!(error instanceof ChildStartupError) || !error.code.startsWith("DATABASE_")) {
    return undefined;
  }
  const path = error.databasePath ?? "the local workspace database";
  return [
    "ScribeAI could not open the writing workspace.",
    error.message,
    `Your data was not reset. Preserve ${path} and any adjacent .bak files before attempting recovery.`,
  ].join("\n\n");
}
