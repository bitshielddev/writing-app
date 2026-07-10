import { DatabaseStartupError } from "./persistence/database/index.js";
import { createStorageTransport } from "./transport.js";
import { createStorageService } from "./service.js";
import {
  BUILD_IDENTIFIER,
  PROTOCOL_VERSION,
  STORAGE_PROTOCOL_NAME,
} from "../../contracts/base.js";
import { STORAGE_RPC_METHODS } from "../../contracts/operations/storage.js";
import {
  ShutdownSchema,
} from "../../contracts/process-messages.js";
import {
  parseOrContractError,
} from "../../contracts/validation.js";

/**
 * What: starts storage process and wires the dependencies it needs.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by index when that path needs this behavior.
 */
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
      /**
       * What: performs the publish event step for this file's workflow.
       *
       * Why: storage workflows need durable, transactional behavior behind the application contract.
       * Called when: used by service and createStorageService when that path needs this behavior.
       */
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

  await service.operations.repairWorkspace(service.operations.catalog().selection);
  const receive = createStorageTransport(
    service.handleRequest,
    (message) => process.parentPort?.postMessage(message),
  );
  process.parentPort?.on("message", ({ data }: { data: unknown }) => {
    try {
      parseOrContractError(ShutdownSchema, data, "storage.shutdown");
      service.close();
      process.exit(0);
    } catch { /* normal request */ }
    void receive(data);
  });
  process.once("exit", () => service.close());
  process.parentPort?.postMessage({
    kind: "ready",
    protocolName: STORAGE_PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    buildIdentifier: BUILD_IDENTIFIER,
    operations: STORAGE_RPC_METHODS,
  });
  await service.dispatchPendingEvents();
  return service;
}

if (process.parentPort) {
  await startStorageProcess(process.argv[2], process.argv[3]);
}
