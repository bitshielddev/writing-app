import { join } from "node:path";

export const DOCUMENT_SCHEMA_VERSION = 1;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoragePaths = {
  workspaceRoot: string;
  draftPath: string;
  sourcesDirectory: string;
  piDirectory: string;
};

/**
 * What: checks workspace identity and throws before invalid state crosses the boundary.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by createStoragePaths when that path needs this behavior.
 */
export function assertWorkspaceIdentity(value: string, label: string) {
  // Version 2 used these two values as durable identities. They remain readable
  // only so the v6 filesystem migration can move the workspace to its scoped path.
  const legacy = value === "default-project" || value === "default-document";
  if (!UUID_PATTERN.test(value) && !legacy) throw new Error(`Invalid ${label} identity`);
  return value;
}

/**
 * What: creates storage paths with the dependencies and defaults this workflow expects.
 *
 * Why: storage workflows need durable, transactional behavior behind the application contract.
 * Called when: used by migration, migrateLegacyWorkspaceFiles, service and forDocument when that path needs this behavior.
 */
export function createStoragePaths(
  applicationWorkspaceRoot: string,
  projectId?: string,
  documentId?: string,
): StoragePaths {
  if (!projectId && !documentId) {
    return { workspaceRoot: applicationWorkspaceRoot,
      draftPath: join(applicationWorkspaceRoot, "draft.md"),
      sourcesDirectory: join(applicationWorkspaceRoot, "sources"),
      piDirectory: join(applicationWorkspaceRoot, ".pi") };
  }
  if (!projectId || !documentId) throw new Error("Both project and document identities are required");
  assertWorkspaceIdentity(projectId, "project");
  assertWorkspaceIdentity(documentId, "document");
  const workspaceRoot = join(
    applicationWorkspaceRoot,
    "projects",
    projectId,
    "documents",
    documentId,
  );
  return {
    workspaceRoot,
    draftPath: join(workspaceRoot, "draft.md"),
    sourcesDirectory: join(workspaceRoot, "sources"),
    piDirectory: join(workspaceRoot, ".pi"),
  };
}
