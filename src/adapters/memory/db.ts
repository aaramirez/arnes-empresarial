import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";
import { migrations as defaultMigrations, type Migration } from "./migrations/index.js";

/**
 * Opens a SQLite database at `filePath` (pass ":memory:" for an ephemeral
 * database, typically in tests), enables foreign key enforcement — required
 * for the `REFERENCES` constraints in the schema to actually be checked —
 * and applies any pending schema migrations before returning.
 *
 * For a real file path, ensures the parent directory exists first —
 * better-sqlite3 does not create missing parent directories on its own and
 * throws instead.
 *
 * If a migration fails, the native handle is closed before the error is
 * rethrown — otherwise it leaks a native resource and, on Windows, keeps
 * the file OS-locked for any retry.
 *
 * `migrationsToApply` defaults to the real schema migrations; it is
 * overridable so tests can force a migration failure deterministically.
 */
export function openDatabase(
  filePath: string,
  migrationsToApply: readonly Migration[] = defaultMigrations,
): Database.Database {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  try {
    runMigrations(db, migrationsToApply);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
