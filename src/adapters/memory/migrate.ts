import type Database from "better-sqlite3";
import { migrations as defaultMigrations, type Migration } from "./migrations/index.js";

interface AppliedMigrationRow {
  id: string;
}

/**
 * Applies pending migrations to `db`, in array order, tracking applied
 * migration ids in a `schema_migrations` table so re-running is a no-op for
 * migrations already applied. All pending migrations run inside a single
 * transaction — if any migration fails, none of the pending batch is
 * recorded as applied.
 */
export function runMigrations(
  db: Database.Database,
  migrationsToApply: readonly Migration[] = defaultMigrations,
): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );

  const appliedIds = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as AppliedMigrationRow[]).map(
      (row) => row.id,
    ),
  );

  const pending = migrationsToApply.filter((migration) => !appliedIds.has(migration.id));
  if (pending.length === 0) return;

  const applyPending = db.transaction((toApply: readonly Migration[]) => {
    const insertApplied = db.prepare(
      "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
    );
    for (const migration of toApply) {
      db.exec(migration.sql);
      insertApplied.run(migration.id, new Date().toISOString());
    }
  });

  applyPending(pending);
}
