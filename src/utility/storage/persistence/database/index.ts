export {
  backupDatabase,
} from "./backup.js";
export {
  inspectDatabase,
  type DatabaseInspection,
} from "./inspection.js";
export {
  DATABASE_MIGRATIONS,
  LEGACY_DATABASE_MIGRATIONS,
  runMigrations,
  validateMigrationRegistry,
  type DatabaseMigration,
} from "./migrations.js";
export {
  createCurrentDatabase,
  openApplicationDatabase,
} from "./open.js";
export {
  CURRENT_SCHEMA_SQL,
  DATABASE_VERSION,
  MINIMUM_SUPPORTED_DATABASE_VERSION,
} from "./schema.js";
export {
  DatabaseStartupError,
  type DatabaseStartupErrorCode,
} from "./startup-error.js";
