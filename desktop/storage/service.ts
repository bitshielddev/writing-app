import type { DurableEventEnvelope } from "../../src/shared/desktop.js";
import { randomUUID } from "node:crypto";
import { StorageOperations } from "../application/storage-operations.js";
import type { WorkspaceFiles } from "../application/storage-ports.js";
import { bootstrapWorkspace } from "./bootstrap.js";
import { createStoragePaths, type StoragePaths } from "./config.js";
import { SqliteDatabaseLifecycle } from "./database-lifecycle.js";
import { OutboxDispatcher, type EventPublisher } from "./outbox.js";
import {
  DocumentRepository,
  OutboxRepository,
  ProjectRepository,
  SourceRepository,
  SuggestionRepository,
  SelectionRepository,
} from "./repositories.js";
import { createStorageRequestHandler } from "./rpc-operations.js";
import { NodeWorkspaceFiles } from "./workspace-files.js";
import { migrateLegacyWorkspaceFiles } from "./workspace-migration.js";
import { backupDatabase, DATABASE_VERSION } from "../database.js";

export type CreateStorageServiceOptions = {
  databasePath: string;
  workspaceRoot: string;
  publishEvent?: (event: DurableEventEnvelope) => void | Promise<void>;
  logger?: Pick<Console, "error">;
  createWorkspaceFiles?: (paths: StoragePaths) => WorkspaceFiles;
};

export function createStorageService(options: CreateStorageServiceOptions) {
  const database = new SqliteDatabaseLifecycle(options.databasePath);
  try {
    database.run(() => bootstrapWorkspace(database.db));
    const projects = new ProjectRepository(database.db);
    const documents = new DocumentRepository(database.db);
    const sources = new SourceRepository(database.db);
    const suggestions = new SuggestionRepository(database.db);
    const selections = new SelectionRepository(database.db);
    const initialSelection = selections.resolve();
    migrateLegacyWorkspaceFiles(
      database.db, options.workspaceRoot, initialSelection.projectId, initialSelection.documentId,
    );
    const outbox = new OutboxRepository(database.db);
    const publisher: EventPublisher = {
      publish: options.publishEvent ?? (() => undefined),
    };
    const dispatcher = new OutboxDispatcher(outbox, publisher);
    const operations = new StorageOperations({
      transactions: database,
      projects,
      documents,
      selections,
      sources,
      suggestions,
      outbox,
      dispatcher,
      workspaces: {
        forDocument(projectId, documentId) {
          const descriptor = createStoragePaths(options.workspaceRoot, projectId, documentId);
          return {
            descriptor,
            files: options.createWorkspaceFiles?.(descriptor) ?? new NodeWorkspaceFiles(descriptor),
          };
        },
      },
      clock: { now: () => Date.now() },
      identities: { next: () => randomUUID() },
      logger: options.logger,
    });
    return {
      get paths() {
        const selected = selections.resolve();
        return createStoragePaths(options.workspaceRoot, selected.projectId, selected.documentId);
      },
      database,
      operations,
      handleRequest: createStorageRequestHandler(operations),
      dispatchPendingEvents: () => dispatcher.dispatch(),
      suggestionMaintenance: {
        verify(projectId: string, documentId: string) {
          return suggestions.verify(projectId, documentId);
        },
        diagnostics(projectId: string, documentId: string) {
          return suggestions.diagnostics(projectId, documentId);
        },
        checkpoint(projectId: string, documentId: string) {
          return suggestions.createCheckpoint(projectId, documentId, 0, true);
        },
        repair(projectId: string, documentId: string) {
          if (options.databasePath === ":memory:") {
            throw new Error("SUGGESTION_REPAIR_REQUIRES_PERSISTED_BACKUP");
          }
          const backupPath = backupDatabase(database.db, options.databasePath, DATABASE_VERSION);
          if (!backupPath) throw new Error("SUGGESTION_REPAIR_BACKUP_FAILED");
          const projection = database.run(() => suggestions.repair(projectId, documentId, true));
          return { backupPath, projection };
        },
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export type StorageService = ReturnType<typeof createStorageService>;
