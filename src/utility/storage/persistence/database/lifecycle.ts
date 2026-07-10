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

  /**
   * What: performs the run step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by ports, createProject, createDocument and performDocumentSave when that path needs this behavior.
   */
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

  /**
   * What: performs the health check step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: called through SqliteDatabaseLifecycle instances when consumers invoke this method.
   */
  healthCheck() {
    this.assertOpen();
    const row = this.db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (row.quick_check !== "ok") throw new Error(`Database health check failed: ${row.quick_check}`);
  }

  /**
   * What: performs the close step for this file's workflow.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by createStorageService when that path needs this behavior.
   */
  close() {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  /**
   * What: checks open and throws before invalid state crosses the boundary.
   *
   * Why: storage workflows need durable, transactional behavior behind the application contract.
   * Called when: used by run and healthCheck when that path needs this behavior.
   */
  private assertOpen() {
    if (this.closed) throw new Error("Storage database is closed");
  }
}
