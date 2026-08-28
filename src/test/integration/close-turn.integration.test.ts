/**
 * Integration test for the Escritura de cierre de turno (Hito 1, tarea 10)
 * against the REAL Memory Adapter (I3) — not a hand-written
 * `MemoryWritePort` stub, same criterio already applied by
 * `assemble-context.integration.test.ts` (Hito 1, tarea 8).
 *
 * Location: `src/test/integration/`, not `src/core/turn-selector/`, for the
 * exact same reason `assemble-context.integration.test.ts` moved there
 * (Reviewer finding, post-tarea-8 verify pass) — this file imports both a
 * core module (`closeTurn`) and adapter modules
 * (`src/adapters/memory/repository.ts`), which would violate AGENTS.md's
 * "`src/core/` nunca importa nada de `src/adapters/*`" rule if it lived
 * under `src/core/`. `src/test/` is the wiring layer's natural home, same
 * role Hito 1, tarea 13/15 will play in production.
 *
 * A pure-unit test for `closeTurn` against a hand-written `MemoryWritePort`
 * (no adapter, no SQLite) already lives at
 * `src/core/turn-selector/close-turn.test.ts` — this file adds the "does
 * the port actually fit the real adapter" guarantee on top.
 */
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import {
  createCaso,
  createSesionAgente,
  getCasoById,
  getLatestSesionAgente,
  updateCaso as updateCasoAdapter,
} from "../../adapters/memory/repository.js";
import type { AgentDefinition } from "../../core/agents/definitions.js";
import { DEFAULT_AGENT_MODEL } from "../../core/agents/definitions.js";
import type { AssembledContext } from "../../core/turn-selector/assemble-context.js";
import type { InvokeModelResult } from "../../core/turn-selector/invoke-model.js";
import { closeTurn, type MemoryWritePort } from "../../core/turn-selector/close-turn.js";

/**
 * Wires the real Memory Adapter (I3) into the `MemoryWritePort` shape
 * `closeTurn` expects — the same one-line-per-method binding the
 * production wiring layer (Hito 1, tarea 13/15) will do.
 */
function toMemoryWritePort(db: Database.Database): MemoryWritePort {
  return {
    updateCaso: (casoId, update) => {
      updateCasoAdapter(db, casoId, update);
    },
    createSesionAgente: (input) => {
      createSesionAgente(db, input);
    },
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

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    systemPrompt: `system prompt for ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

function makeContext(casoId: string): AssembledContext {
  return {
    caso: {
      id: casoId,
      tipo: "conversacion",
      estado: "abierto",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    },
    resumeSessionId: undefined,
  };
}

function makeResult(sdkSessionId: string): InvokeModelResult {
  return { responseText: "respuesta del modelo", sdkSessionId };
}

describe("closeTurn (integration against the real Memory Adapter)", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("updates the caso's estado and records the new sdk_session_id as the latest sesion_agente", () => {
    db = openDatabase(":memory:");
    seedCaso(db);
    const agent = makeAgent("agente-conversacional");
    const context = makeContext("caso-1");
    const result = makeResult("sdk-session-abc");

    closeTurn(toMemoryWritePort(db), context, agent, result, "en-progreso", {
      now: () => "2026-08-27T01:00:00.000Z",
      generateSesionId: () => "sesion-1",
    });

    const caso = getCasoById(db, "caso-1");
    expect(caso?.estado).toBe("en-progreso");
    expect(caso?.updatedAt).toBe("2026-08-27T01:00:00.000Z");

    const sesion = getLatestSesionAgente(db, "caso-1", "agente-conversacional");
    expect(sesion?.sdkSessionId).toBe("sdk-session-abc");
    expect(sesion?.id).toBe("sesion-1");
  });

  it("inserts a new sesion_agente row instead of updating a prior one for the same agent", () => {
    db = openDatabase(":memory:");
    seedCaso(db);
    createSesionAgente(db, {
      id: "sesion-previa",
      casoId: "caso-1",
      agentId: "agente-conversacional",
      sdkSessionId: "sdk-session-viejo",
      createdAt: "2026-08-27T00:00:01.000Z",
    });
    const agent = makeAgent("agente-conversacional");
    const context = makeContext("caso-1");
    const result = makeResult("sdk-session-nuevo");

    closeTurn(toMemoryWritePort(db), context, agent, result, "cerrado", {
      now: () => "2026-08-27T02:00:00.000Z",
      generateSesionId: () => "sesion-nueva",
    });

    const sesion = getLatestSesionAgente(db, "caso-1", "agente-conversacional");
    expect(sesion?.id).toBe("sesion-nueva");
    expect(sesion?.sdkSessionId).toBe("sdk-session-nuevo");

    // The prior row is still there, untouched — closing a turn never
    // updates an existing sesion_agente row, it only inserts a new one.
    const previaAún = db
      .prepare("SELECT sdk_session_id FROM sesiones_agente WHERE id = ?")
      .get("sesion-previa") as { sdk_session_id: string } | undefined;
    expect(previaAún?.sdk_session_id).toBe("sdk-session-viejo");
  });
});
