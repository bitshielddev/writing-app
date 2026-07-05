import { DatabaseStartupError } from "./database.js";
import { createStorageTransport } from "./storage-transport.js";
import { createStorageService } from "./storage/service.js";
import { PROTOCOL_VERSION } from "../src/shared/contracts.js";

export async function startStorageProcess(
  databasePath: string | undefined,
  workspaceRoot: string | undefined,
) {
  if (!databasePath || !workspaceRoot) {
    throw new Error("Storage process requires database and project workspace paths");
  }

  let service;
  try {
    service = createStorageService({
      databasePath,
      workspaceRoot,
      publishEvent(event) {
        process.parentPort?.postMessage({
          kind: "domain.event",
          protocolVersion: PROTOCOL_VERSION,
          event,
        });
      },
    });
  } catch (error) {
    const startupError = error instanceof DatabaseStartupError
      ? error
      : new DatabaseStartupError(
          "DATABASE_CORRUPT",
          databasePath,
          error instanceof Error ? error.message : String(error),
          { cause: error },
        );
    process.parentPort?.postMessage({
      kind: "startup.error",
      protocolVersion: PROTOCOL_VERSION,
      error: {
        code: startupError.code,
        message: "The workspace database could not be opened",
        retryable: false,
        details: { databasePath: startupError.databasePath },
      },
    });
    throw startupError;
  }

  await service.operations.repairWorkspace();
  const receive = createStorageTransport(
    service.handleRequest,
    (message) => process.parentPort?.postMessage(message),
  );
  process.parentPort?.on("message", ({ data }: { data: unknown }) => {
    void receive(data);
  });
  process.once("exit", () => service.close());
  process.parentPort?.postMessage({ kind: "ready", protocolVersion: PROTOCOL_VERSION });
  await service.dispatchPendingEvents();
  return service;
}

if (process.parentPort) {
  await startStorageProcess(process.argv[2], process.argv[3]);
}
