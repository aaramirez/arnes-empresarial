/**
 * Integration test for the Ensamblador de Contexto (Hito 1, tarea 8)
 * against the REAL Memory Adapter (I3) — not a hand-written
 * `MemoryContextPort` stub.
 *
 * Location decision (Reviewer finding, post-tarea-8 verify pass): this file
 * previously lived at `src/core/turn-selector/assemble-context.test.ts` and
 * imported `openDatabase` / `createCaso` / `createSesionAgente` /
 * `getCasoById` / `getLatestSesionAgente` directly from
 * `src/adapters/memory/*` — which broke AGENTS.md's non-negotiable rule
 * ("`src/core/` nunca importa nada de `src/adapters/*`") from the very test
 * file meant to exercise the module that exists specifically to respect
 * that rule (`MemoryContextPort` in `assemble-context.ts`).
 *
 * Fix chosen (of the two options raised in review): move this test out of
 * `src/core/` into `src/test/integration/`, instead of replacing the real
 * adapter binding with a hand-written fake. Rationale:
 * - `src/test/` is not `src/core/` nor `src/adapters/*` — it is the wiring
 *   layer's natural home (the same role Hito 1, tarea 13/15 will play in
 *   production), so importing both a core module and an adapter module
 *   from here does not violate the boundary rule; the rule is about what
 *   `src/core/` itself may import, not about whether integration coverage
 *   may exist at all.
 * - A hand-written fake `MemoryContextPort` would only prove the port's
 *   shape compiles — it stops proving that `getCasoById` /
 *   `getLatestSesionAgente` (`src/adapters/memory/repository.ts`) actually
 *   satisfy that shape at runtime, and silently drifts out of sync the day
 *   `repository.ts` changes without anyone touching this test.
 * - Staying inside `src/` (rather than a project-root `test/`) keeps this
 *   file inside `tsconfig.json`'s `rootDir`/`include` (`"src"`), so
 *   `npm run typecheck` still type-checks it like every other test in the
 *   repo — a project-root `test/` directory would silently fall outside
 *   that command's scope.
 *
 * A pure-unit test for `assembleContext` against a hand-written
 * `MemoryContextPort` (no adapter, no SQLite) still belongs under
 * `src/core/turn-selector/` — this file does not replace that; it adds the
 * "does the port actually fit the real adapter" guarantee on top.
 */
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import {
  createCaso,
  createSesionAgente,
  getCasoById,
  getLatestSesionAgente,
} from "../../adapters/memory/repository.js";
import {
  CasoNotResolvedError,
  assembleContext,
  type MemoryContextPort,
} from "../../core/turn-selector/assemble-context.js";

/**
 * Wires the real Memory Adapter (I3) into the `MemoryContextPort` shape
 * `assembleContext` expects — the same one-line-per-method binding the
 * production wiring layer (Hito 1, tarea 13/15) will do.
 */
function toMemoryPort(db: Database.Database): MemoryContextPort {
  return {
    getCasoById: (casoId) => getCasoById(db, casoId),
    getLatestSesionAgente: (casoId, agentId) => getLatestSesionAgente(db, casoId, agentId),
  };
}

function seedCaso(db: Database.Database) {
  createCaso(db, {
    id: "caso-1",
    tipo: "conversacion",
    estado: "abierto",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  });
}

describe("assembleContext (integration against the real Memory Adapter)", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("resolves the caso and no resumeSessionId when the agent has no prior session in this caso", () => {
    db = openDatabase(":memory:");
    seedCaso(db);

    const result = assembleContext(toMemoryPort(db), "caso-1", "agente-conversacional");

    expect(result.caso).toEqual({
      id: "caso-1",
      tipo: "conversacion",
      estado: "abierto",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(result.resumeSessionId).toBeUndefined();
  });

  it("resolves resumeSessionId from the latest sesion_agente for that agent", () => {
    db = openDatabase(":memory:");
    seedCaso(db);
    createSesionAgente(db, {
      id: "sesion-1",
      casoId: "caso-1",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-abc",
      createdAt: "2026-08-27T00:00:01.000Z",
    });

    const result = assembleContext(toMemoryPort(db), "caso-1", "agente-conversacional");

    expect(result.resumeSessionId).toBe("sdk-session-abc");
  });

  it("does not mix resumeSessionId from a different agent that already participated in the same caso", () => {
    db = openDatabase(":memory:");
    seedCaso(db);
    createSesionAgente(db, {
      id: "sesion-otro",
      casoId: "caso-1",
      agentId: "otro-agente",
      sdkSessionId: "sdk-session-otro",
      createdAt: "2026-08-27T00:00:01.000Z",
    });

    const result = assembleContext(toMemoryPort(db), "caso-1", "agente-conversacional");

    expect(result.resumeSessionId).toBeUndefined();
  });

  it("throws CasoNotResolvedError when casoId does not resolve to an existing caso", () => {
    db = openDatabase(":memory:");

    expect(() =>
      assembleContext(toMemoryPort(db!), "no-existe", "agente-conversacional"),
    ).toThrow(CasoNotResolvedError);
  });
});
