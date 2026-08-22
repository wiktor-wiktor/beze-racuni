import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SqlValue = null | number | string | bigint | Uint8Array;

class NodeD1PreparedStatement {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: SqlValue[]) {
    const bound = new NodeD1PreparedStatement(this.database, this.query);
    bound.values = values;
    return bound;
  }

  async run() {
    return this.runSync();
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const row = this.statement().get(...this.values) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    return {
      success: true,
      results: this.statement().all(...this.values) as T[],
    };
  }

  runSync() {
    const statement = this.statement();
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.values),
      };
    }

    const result = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
      },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

class NodeD1Database {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
  }

  prepare(query: string) {
    return new NodeD1PreparedStatement(this.database, query);
  }

  async batch(statements: NodeD1PreparedStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const databasePath =
  process.env.BH_DB_PATH ??
  resolve(process.cwd(), ".wrangler/node/bezenskova-house.sqlite");

const bindings: Record<string, unknown> = {
  DB: new NodeD1Database(databasePath),
};

export const env = new Proxy(bindings, {
  get(target, property) {
    if (typeof property !== "string") return target[property as never];
    return target[property] ?? process.env[property];
  },
});

// Vinext's Cloudflare compatibility shim re-exports these base classes even
// when the application does not use them. Node builds only need placeholders.
export class WorkerEntrypoint {}
export class DurableObject {}
export class WorkflowEntrypoint {}
