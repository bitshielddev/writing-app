import type { DurableEventEnvelope } from "../../contracts/desktop-bridge.js";
import { randomUUID } from "node:crypto";
import { StorageOperations } from "./application/operations.js";
import type { WorkspaceFiles } from "./application/ports.js";
import { bootstrapWorkspace } from "./workspace/bootstrap.js";
import { createStoragePaths, type StoragePaths } from "./workspace/config.js";
import { SqliteDatabaseLifecycle } from "./persistence/database/lifecycle.js";
import { OutboxDispatcher, type EventPublisher } from "./persistence/outbox-dispatcher.js";
import { DocumentRepository } from "./persistence/repositories/documents.js";
import { OutboxRepository } from "./persistence/repositories/outbox.js";
import { ProjectRepository } from "./persistence/repositories/projects.js";
import { SelectionRepository } from "./persistence/repositories/selection.js";
import { SourceRepository } from "./persistence/repositories/sources.js";
import { SuggestionRepository } from "./persistence/repositories/suggestions.js";
import { createStorageRequestHandler } from "./transport.js";
import { NodeWorkspaceFiles } from "./workspace/files.js";
import { migrateLegacyWorkspaceFiles } from "./workspace/migration.js";
import { backupDatabase, DATABASE_VERSION } from "./persistence/database/index.js";

export type CreateStorageServiceOptions = {
  databasePath: string;
  workspaceRoot: string;
  publishEvent?: (event: DurableEventEnvelope) => void | Promise<void>;
  logger?: Pick<Console, "error">;
  createWorkspaceFiles?: (paths: StoragePaths) => WorkspaceFiles;
};

/**
 * What: creates storage service with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by service, index, startStorageProcess and layers when that path needs this behavior.
 */
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
        /**
         * What: performs the for document step for this file's workflow.
         *
         * Why: storage workflows need durable, transactional behavior behind the application contract.
         * Called when: used by ports, operations and workspace when that path needs this behavior.
         */
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
        /**
         * What: performs the verify step for this file's workflow.
         *
         * Why: storage workflows need durable, transactional behavior behind the application contract.
         * Called when: used by suggestion-persistence when that path needs this behavior.
         */
        verify(projectId: string, documentId: string) {
          return suggestions.verify(projectId, documentId);
        },
        /**
         * What: performs the diagnostics step for this file's workflow.
         *
         * Why: storage workflows need durable, transactional behavior behind the application contract.
         * Called when: used by suggestion-persistence when that path needs this behavior.
         */
        diagnostics(projectId: string, documentId: string) {
          return suggestions.diagnostics(projectId, documentId);
        },
        /**
         * What: performs the checkpoint step for this file's workflow.
         *
         * Why: storage workflows need durable, transactional behavior behind the application contract.
         * Called when: used by suggestion-persistence when that path needs this behavior.
         */
        checkpoint(projectId: string, documentId: string) {
          return suggestions.createCheckpoint(projectId, documentId, 0, true);
        },
        /**
         * What: performs the repair step for this file's workflow.
         *
         * Why: storage workflows need durable, transactional behavior behind the application contract.
         * Called when: used by the enclosing workflow at the point this named step is required.
         */
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
