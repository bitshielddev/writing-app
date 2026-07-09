import type { DatabaseSync } from "node:sqlite";
import type { TransactionManager } from "../../application/ports.js";

import { DATABASE_MIGRATIONS } from "./migrations.js";
import { openApplicationDatabase } from "./open.js";

export class SqliteDatabaseLifecycle implements TransactionManager {
  readonly db: DatabaseSync;
  private closed = false;

  constructor(databasePath: string) {
    this.db = openApplicationDatabase(databasePath, DATABASE_MIGRATIONS);
  }

  run<T>(work: () => T): T {
    this.assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  healthCheck() {
    this.assertOpen();
    const row = this.db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (row.quick_check !== "ok") throw new Error(`Database health check failed: ${row.quick_check}`);
  }

  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private assertOpen() {
    if (this.closed) throw new Error("Storage database is closed");
  }
}
