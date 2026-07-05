import { join } from "node:path";

export const DEFAULT_PROJECT_ID = "default-project";
export const DEFAULT_DOCUMENT_ID = "default-document";
export const DOCUMENT_SCHEMA_VERSION = 1;

export type StoragePaths = {
  workspaceRoot: string;
  draftPath: string;
  sourcesDirectory: string;
  piDirectory: string;
};

export function createStoragePaths(workspaceRoot: string): StoragePaths {
  return {
    workspaceRoot,
    draftPath: join(workspaceRoot, "draft.md"),
    sourcesDirectory: join(workspaceRoot, "sources"),
    piDirectory: join(workspaceRoot, ".pi"),
  };
}
