export type DatabaseStartupErrorCode =
  | "DATABASE_TOO_NEW"
  | "DATABASE_LEGACY_UNKNOWN"
  | "DATABASE_MIGRATION_FAILED"
  | "DATABASE_CORRUPT";

export class DatabaseStartupError extends Error {
  constructor(
    readonly code: DatabaseStartupErrorCode,
    readonly databasePath: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message} Database: ${databasePath}`, options);
    this.name = "DatabaseStartupError";
  }
}
