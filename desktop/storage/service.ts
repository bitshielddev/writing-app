import type { DesktopEvent } from "../../src/shared/desktop.js";
import { bootstrapWorkspace } from "./bootstrap.js";
import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_PROJECT_ID,
  createStoragePaths,
  type StoragePaths,
} from "./config.js";
import { SqliteDatabaseLifecycle } from "./database-lifecycle.js";
import { StorageOperations } from "./operations.js";
import { OutboxDispatcher, type EventPublisher } from "./outbox.js";
import {
  DocumentRepository,
  OutboxRepository,
  ProjectRepository,
  SourceRepository,
  SuggestionRepository,
} from "./repositories.js";
import { createStorageRequestHandler } from "./rpc-operations.js";
import { NodeWorkspaceFiles, type WorkspaceFiles } from "./workspace-files.js";

export type CreateStorageServiceOptions = {
  databasePath: string;
  workspaceRoot: string;
  projectId?: string;
  documentId?: string;
  publishEvent?: (event: DesktopEvent) => void | Promise<void>;
  logger?: Pick<Console, "error">;
  createWorkspaceFiles?: (paths: StoragePaths) => WorkspaceFiles;
};

export function createStorageService(options: CreateStorageServiceOptions) {
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  const documentId = options.documentId ?? DEFAULT_DOCUMENT_ID;
  const paths = createStoragePaths(options.workspaceRoot);
  const database = new SqliteDatabaseLifecycle(options.databasePath);
  try {
    database.run(() => bootstrapWorkspace(database.db, projectId, documentId));
    const projects = new ProjectRepository(database.db);
    const documents = new DocumentRepository(database.db);
    const sources = new SourceRepository(database.db);
    const suggestions = new SuggestionRepository(database.db);
    const outbox = new OutboxRepository(database.db);
    const files = options.createWorkspaceFiles?.(paths) ?? new NodeWorkspaceFiles(paths);
    const publisher: EventPublisher = {
      publish: options.publishEvent ?? (() => undefined),
    };
    const dispatcher = new OutboxDispatcher(outbox, publisher);
    const operations = new StorageOperations({
      projectId,
      documentId,
      paths,
      transactions: database,
      projects,
      documents,
      sources,
      suggestions,
      outbox,
      dispatcher,
      files,
      logger: options.logger,
    });
    return {
      paths,
      database,
      operations,
      handleRequest: createStorageRequestHandler(operations),
      dispatchPendingEvents: () => dispatcher.dispatch(),
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export type StorageService = ReturnType<typeof createStorageService>;
