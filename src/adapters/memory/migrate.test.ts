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

  it("creates vendedores, ventas, comisiones and idx_ventas_vendedor, idx_comisiones_periodo on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    const names = tableNames(db);
    expect(names).toContain("vendedores");
    expect(names).toContain("ventas");
    expect(names).toContain("comisiones");
    expect(indexNames(db)).toContain("idx_ventas_vendedor");
    expect(indexNames(db)).toContain("idx_comisiones_periodo");
  });

  it("rejects inserting a venta with a non-existent vendedor_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "venta", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO ventas (id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "venta-1",
          "vendedor-inexistente",
          "cliente-1",
          null,
          "plan-pro",
          100,
          "pendiente_confirmacion",
          "caso-1",
          "token-1",
          "2026-08-26T00:00:00.000Z",
          null,
          null,
        ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects inserting a venta with a non-existent caso_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO vendedores (id, nombre, created_at) VALUES (?, ?, ?)",
    ).run("vendedor-1", "Jimmy Fung", "2026-08-26T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO ventas (id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "venta-1",
          "vendedor-1",
          "cliente-1",
          null,
          "plan-pro",
          100,
          "pendiente_confirmacion",
          "caso-inexistente",
          "token-1",
          "2026-08-26T00:00:00.000Z",
          null,
          null,
        ),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects inserting two ventas with the same token_confirmacion", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO vendedores (id, nombre, created_at) VALUES (?, ?, ?)",
    ).run("vendedor-1", "Jimmy Fung", "2026-08-26T00:00:00.000Z");
    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "venta", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");
    db.prepare(
      "INSERT INTO ventas (id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "venta-1",
      "vendedor-1",
      "cliente-1",
      null,
      "plan-pro",
      100,
      "pendiente_confirmacion",
      "caso-1",
      "token-duplicado",
      "2026-08-26T00:00:00.000Z",
      null,
      null,
    );

    expect(() =>
      db
        .prepare(
          "INSERT INTO ventas (id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, token_confirmacion, created_at, confirmed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "venta-2",
          "vendedor-1",
          "cliente-2",
          null,
          "plan-pro",
          200,
          "pendiente_confirmacion",
          "caso-1",
          "token-duplicado",
          "2026-08-26T00:00:00.000Z",
          null,
          null,
        ),
    ).toThrow(/UNIQUE/);
  });

  it("creates registro_acciones_empleado and idx_registro_acciones_venta on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    const names = tableNames(db);
    expect(names).toContain("registro_acciones_empleado");
    expect(indexNames(db)).toContain("idx_registro_acciones_venta");
  });

  it("rejects inserting a registro_acciones_empleado row with a non-existent venta_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    expect(() =>
      db
        .prepare(
          "INSERT INTO registro_acciones_empleado (id, empleado_id, comando, venta_id, caso_id, resultado, ocurrido_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run("accion-1", "ana", "/aprobar-reembolso", "venta-inexistente", null, "aprobada", "2026-08-26T00:00:00.000Z"),
    ).toThrow(/FOREIGN KEY/);
  });

  it("allows inserting a registro_acciones_empleado row with venta_id and caso_id NULL (consulta de soporte)", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO registro_acciones_empleado (id, empleado_id, comando, venta_id, caso_id, resultado, ocurrido_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("accion-1", "ana", "/soporte", null, null, "atendida", "2026-08-26T00:00:00.000Z");

    const row = db
      .prepare("SELECT empleado_id, venta_id, caso_id FROM registro_acciones_empleado WHERE id = ?")
      .get("accion-1") as { empleado_id: string; venta_id: string | null; caso_id: string | null };
    expect(row.empleado_id).toBe("ana");
    expect(row.venta_id).toBeNull();
    expect(row.caso_id).toBeNull();
  });

  it("creates credenciales_empleado on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    expect(tableNames(db)).toContain("credenciales_empleado");
  });

  it("allows inserting a credenciales_empleado row keyed by empleado_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO credenciales_empleado (empleado_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("ana", "scrypt$16384$8$1$c2FsdA==$Y2xhdmU=", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    const row = db
      .prepare("SELECT password_hash FROM credenciales_empleado WHERE empleado_id = ?")
      .get("ana") as { password_hash: string };
    expect(row.password_hash).toBe("scrypt$16384$8$1$c2FsdA==$Y2xhdmU=");
  });

  it("rejects inserting two credenciales_empleado rows with the same empleado_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO credenciales_empleado (empleado_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("ana", "hash-1", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO credenciales_empleado (empleado_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run("ana", "hash-2", "2026-08-26T01:00:00.000Z", "2026-08-26T01:00:00.000Z"),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it("creates roles_empleado on a fresh database", () => {
    const db = new Database(":memory:");

    runMigrations(db);

    expect(tableNames(db)).toContain("roles_empleado");
  });

  it("allows inserting a roles_empleado row keyed by empleado_id", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO roles_empleado (empleado_id, rol, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("ana", "administrador", "2026-09-13T00:00:00.000Z", "2026-09-13T00:00:00.000Z");

    const row = db
      .prepare("SELECT rol FROM roles_empleado WHERE empleado_id = ?")
      .get("ana") as { rol: string };
    expect(row.rol).toBe("administrador");
  });

  it("leaves roles_empleado with zero rows after migrating a database with pre-existing credenciales_empleado rows (default-deny sin backfill, ADR 156/157)", () => {
    const db = new Database(":memory:");

    db.exec(
      `CREATE TABLE IF NOT EXISTS credenciales_empleado (
        empleado_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    db.prepare(
      "INSERT INTO credenciales_empleado (empleado_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("ana", "hash-preexistente", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    runMigrations(db);

    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM roles_empleado")
      .get() as CountRow;
    expect(count).toBe(0);
  });
});
