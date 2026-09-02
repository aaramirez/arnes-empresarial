import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";
import { migrations as defaultMigrations, type Migration } from "./migrations/index.js";

/**
 * Opens a SQLite database at `filePath` (pass ":memory:" for an ephemeral
 * database, typically in tests), enables foreign key enforcement — required
 * for the `REFERENCES` constraints in the schema to actually be checked —
 * switches the journal mode to WAL (ignored by SQLite for `:memory:`), and
 * applies any pending schema migrations before returning.
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
  // Hito 3: WAL habilita lectores concurrentes con un escritor y elimina el
  // bloqueo de base completa del journal por defecto — la mitad de
  // infraestructura de la estrategia de concurrencia (la otra mitad es la
  // cola por `proyecto_id`, ADR 8). Aparecen `<archivo>.db-wal` y
  // `<archivo>.db-shm` junto a `data/harness.db` (ver `.gitignore`, §8).
  // Reversible con `journal_mode = DELETE` sin pérdida de datos.
  // Para `:memory:` SQLite ignora el pedido y sigue en modo `memory` — los
  // tests que abren bases en memoria no cambian de comportamiento.
  db.pragma("journal_mode = WAL");
  try {
    runMigrations(db, migrationsToApply);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
