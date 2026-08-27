import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import type { Migration } from "./migrations/index.js";

interface TableRow {
  name: string;
}

interface CountRow {
  count: number;
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as TableRow[]
  ).map((row) => row.name);
}

describe("runMigrations", () => {
  it("creates casos and sesiones_agente on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    const names = tableNames(db);
    expect(names).toContain("casos");
    expect(names).toContain("sesiones_agente");
  });

  it("allows inserting a sesion_agente row correlated to a caso", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "conversacion", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");
    db.prepare(
      "INSERT INTO sesiones_agente (id, caso_id, agent_id, sdk_session_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("sesion-1", "caso-1", "agente-conversacional", "sdk-session-abc", "2026-08-26T00:00:01.000Z");

    const row = db
      .prepare("SELECT caso_id FROM sesiones_agente WHERE id = ?")
      .get("sesion-1") as { caso_id: string };
    expect(row.caso_id).toBe("caso-1");
  });

  it("records applied migrations and does not reapply them on a second run", () => {
    const db = new Database(":memory:");

    runMigrations(db);
    runMigrations(db);

    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM schema_migrations")
      .get() as CountRow;
    expect(count).toBe(1);
  });

  it("applies a custom migration list in array order", () => {
    const db = new Database(":memory:");
    const migrations: Migration[] = [
      { id: "0001_create_widgets", sql: "CREATE TABLE widgets (id TEXT PRIMARY KEY);" },
      { id: "0002_add_widget_name", sql: "ALTER TABLE widgets ADD COLUMN name TEXT;" },
    ];

    runMigrations(db, migrations);

    db.prepare("INSERT INTO widgets (id, name) VALUES (?, ?)").run("w1", "gadget");
    const row = db.prepare("SELECT name FROM widgets WHERE id = ?").get("w1") as {
      name: string;
    };
    expect(row.name).toBe("gadget");
  });
});
