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

function indexNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
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
    const { count: countAfterFirstRun } = db
      .prepare("SELECT COUNT(*) as count FROM schema_migrations")
      .get() as CountRow;

    runMigrations(db);
    const { count: countAfterSecondRun } = db
      .prepare("SELECT COUNT(*) as count FROM schema_migrations")
      .get() as CountRow;

    // Compares before/after the second run instead of a hardcoded literal,
    // so this test does not need to change every time a migration is added.
    expect(countAfterSecondRun).toBe(countAfterFirstRun);
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

  it("creates proyectos, responsables, actividades and idx_actividades_proyecto on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    const names = tableNames(db);
    expect(names).toContain("proyectos");
    expect(names).toContain("responsables");
    expect(names).toContain("actividades");
    expect(indexNames(db)).toContain("idx_actividades_proyecto");
  });

  it("running the migrations twice does not fail", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    expect(() => runMigrations(db)).not.toThrow();
  });

  it("rejects inserting an actividad with a non-existent proyecto_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "conversacion", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO actividades (id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "actividad-1",
          "proyecto-inexistente",
          "pr_review",
          "org/repo#1",
          null,
          "caso-1",
          "abierta",
          "2026-08-26T00:00:00.000Z",
          "2026-08-26T00:00:00.000Z",
        ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects inserting an actividad with a non-existent caso_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO proyectos (id, nombre, repo_url, created_at) VALUES (?, ?, ?, ?)",
    ).run("proyecto-1", "Harness Empresarial", "https://github.com/org/repo", "2026-08-26T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO actividades (id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "actividad-1",
          "proyecto-1",
          "pr_review",
          "org/repo#1",
          null,
          "caso-inexistente",
          "abierta",
          "2026-08-26T00:00:00.000Z",
          "2026-08-26T00:00:00.000Z",
        ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("allows inserting a valid actividad correlated to a proyecto, caso and responsable", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO proyectos (id, nombre, repo_url, created_at) VALUES (?, ?, ?, ?)",
    ).run("proyecto-1", "Harness Empresarial", "https://github.com/org/repo", "2026-08-26T00:00:00.000Z");
    db.prepare(
      "INSERT INTO responsables (id, nombre, created_at) VALUES (?, ?, ?)",
    ).run("responsable-1", "Jimmy Fung", "2026-08-26T00:00:00.000Z");
    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "pr_review", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    db.prepare(
      "INSERT INTO actividades (id, proyecto_id, tipo, referencia_externa, responsable_id, caso_id, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "actividad-1",
      "proyecto-1",
      "pr_review",
      "org/repo#1",
      "responsable-1",
      "caso-1",
      "abierta",
      "2026-08-26T00:00:00.000Z",
      "2026-08-26T00:00:00.000Z",
    );

    const row = db
      .prepare("SELECT proyecto_id, caso_id FROM actividades WHERE id = ?")
      .get("actividad-1") as { proyecto_id: string; caso_id: string };
    expect(row.proyecto_id).toBe("proyecto-1");
    expect(row.caso_id).toBe("caso-1");
  });
});
