import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "./db.js";
import type { Migration } from "./migrations/index.js";

describe("openDatabase", () => {
  let tempDir: string | undefined;
  let openDb: Database.Database | undefined;

  afterEach(() => {
    openDb?.close();
    openDb = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates missing nested parent directories before opening a real file database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-db-test-"));
    const filePath = join(tempDir, "nested", "sub", "harness.db");

    openDb = openDatabase(filePath);

    expect(existsSync(filePath)).toBe(true);
  });

  it("opens normally, without erroring, when the parent directory already exists", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-db-test-"));
    const filePath = join(tempDir, "harness.db");

    openDb = openDatabase(filePath);
    openDb
      .prepare(
        "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("caso-1", "conversacion", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    const row = openDb.prepare("SELECT tipo FROM casos WHERE id = ?").get("caso-1") as {
      tipo: string;
    };
    expect(row.tipo).toBe("conversacion");
  });

  it("applies the schema migrations so casos and sesiones_agente are usable immediately", () => {
    const db = openDatabase(":memory:");

    db.prepare(
      "INSERT INTO casos (id, tipo, estado, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("caso-1", "conversacion", "abierto", "2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z");

    const row = db.prepare("SELECT tipo FROM casos WHERE id = ?").get("caso-1") as {
      tipo: string;
    };
    expect(row.tipo).toBe("conversacion");
  });

  it("enforces foreign keys, rejecting a sesion_agente row for a non-existent caso", () => {
    const db = openDatabase(":memory:");

    expect(() =>
      db
        .prepare(
          "INSERT INTO sesiones_agente (id, caso_id, agent_id, sdk_session_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("sesion-1", "caso-inexistente", "agente-conversacional", "sdk-session-abc", "2026-08-26T00:00:01.000Z"),
    ).toThrow(/FOREIGN KEY/);
  });

  it("closes the native db handle if a migration fails, instead of leaking it", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-db-test-"));
    const filePath = join(tempDir, "harness.db");
    const brokenMigrations: Migration[] = [
      { id: "0001_broken", sql: "THIS IS NOT VALID SQL;" },
    ];

    expect(() => openDatabase(filePath, brokenMigrations)).toThrow();

    // If the native handle were still open, deleting the underlying file
    // would fail on Windows with an OS-level lock error (EBUSY/EPERM)
    // because the process still holds a handle to it.
    expect(() => rmSync(filePath)).not.toThrow();
  });

  it("enables WAL journal mode when opening a real file database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "harness-db-test-"));
    const filePath = join(tempDir, "harness.db");

    openDb = openDatabase(filePath);

    expect(openDb.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("leaves :memory: databases in memory journal mode, unaffected by the WAL pragma", () => {
    const db = openDatabase(":memory:");

    expect(db.pragma("journal_mode", { simple: true })).toBe("memory");
  });
});
