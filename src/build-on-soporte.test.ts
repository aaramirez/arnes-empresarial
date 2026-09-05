/**
 * Tests for `buildOnSoporte` — ver el module doc de `build-on-soporte.ts`
 * para el contrato completo (el ÚNICO camino de este hito que invoca al
 * modelo, spec `soporte-web-turno`).
 *
 * `handle-turn.js` se mockea ENTERO (no un spy sobre la implementación
 * real), mismo criterio que `build-on-activity.test.ts` documenta: acá
 * también la única costura disponible para controlar el resultado sin
 * pegarle al SDK real es `vi.mock`. Nada de este archivo necesita el
 * comportamiento real de `handleTurn` — todos los tests de abajo son sobre
 * el WIRING alrededor de él: el orden `createCaso` → `handleTurn`, la
 * fábrica de conocimiento por `casoId`, la propagación de `TurnFailedError`
 * y el spread condicional de `logDeps`.
 *
 * `createCaso` se ejercita contra un `openDatabase(":memory:")` REAL (no un
 * doble), porque `buildOnSoporte` no recibe un `store` inyectable — a
 * diferencia de `buildOnActivity`/`buildOnVenta`, este módulo llama
 * `createCaso`/`getCasoById` directo sobre `repository.ts` (ver
 * `build-on-soporte.ts`, sin `VentaStorePort`/`ActivityStorePort`
 * equivalente). Un SQLite real es la única forma honesta de probar el orden
 * `createCaso` → `handleTurn`: consultar `getCasoById` DENTRO del mock de
 * `handleTurn` es una señal real de secuencia de ejecución, no una
 * suposición de timing artificial — mismo criterio que el test de orden de
 * `build-on-submit.test.ts` ya documenta para `getCasoById`/
 * `onAgentResolved`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { buildOnSoporte, type BuildOnSoporteDeps } from "./build-on-soporte.js";
import { CASO_TIPO_SOPORTE } from "./core/ventas/ventas-contract.js";
import { buildSoportePrompt } from "./core/ventas/soporte-prompt.js";
import { TurnFailedError } from "./core/turn-selector/turn-error.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import { DEFAULT_AGENT_MODEL, type AgentDefinition } from "./core/agents/definitions.js";
import { openDatabase } from "./adapters/memory/db.js";
import { getCasoById } from "./adapters/memory/repository.js";
import type { MemoryPort } from "./core/turn-selector/handle-turn.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";

vi.mock("./core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

import { handleTurn } from "./core/turn-selector/handle-turn.js";

const mockedHandleTurn = vi.mocked(handleTurn);

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
/** Molde exacto de `CASO_ESTADO_ACTIVO` en `handle-turn.ts`/`registrar-venta.ts` — duplicado local a propósito, no un descuido (AGENTS.md). */
const CASO_ESTADO_ACTIVO = "activo";

const outcomeBase = { responseText: "Respuesta del agente de soporte.", agentLabel: "agente-conversacional" };

function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn(),
    getLatestSesionAgente: vi.fn(),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

function makeAgent(id: string): AgentDefinition {
  return {
    id,
    systemPrompt: `system prompt de ${id}`,
    allowedTools: [],
    model: DEFAULT_AGENT_MODEL,
  };
}

function makeFakeKnowledge(): (casoId: string) => KnowledgeAdapter {
  return vi.fn(
    (): KnowledgeAdapter => ({
      mcpServers: {},
      feedback: {
        saveTurnResult: vi.fn().mockResolvedValue(undefined),
        discardPendingCitations: vi.fn(),
      },
    }),
  );
}

/** Captura líneas en memoria en vez de tocar el filesystem real — mismo criterio que `build-on-activity.test.ts`/`build-on-submit.test.ts` documentan. */
function fakeLogDeps(): LogTurnEventDeps & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    now: () => TIMESTAMP,
    write: (line) => {
      lines.push(line);
    },
    lines,
  };
}

function parseLastLine(lines: readonly string[]): Record<string, unknown> {
  const last = lines.at(-1);
  expect(last).toBeDefined();
  return JSON.parse(last as string) as Record<string, unknown>;
}

function makeCounterNewId(prefix = "id"): () => string {
  let contador = 0;
  return () => `${prefix}-${++contador}`;
}

interface BaseDepsOverrides {
  readonly createKnowledge?: (casoId: string) => KnowledgeAdapter;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
  readonly agents?: readonly AgentDefinition[];
}

function makeBaseDeps(db: Database.Database, overrides: BaseDepsOverrides = {}): BuildOnSoporteDeps {
  return {
    db,
    memory: fakeMemory(),
    hooks: createHookEngine(),
    agents: overrides.agents ?? [makeAgent("agente-conversacional")],
    createKnowledge: overrides.createKnowledge ?? makeFakeKnowledge(),
    ...(overrides.newId ? { newId: overrides.newId } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.logDeps ? { logDeps: overrides.logDeps } : {}),
  };
}

beforeEach(() => {
  mockedHandleTurn.mockReset();
  mockedHandleTurn.mockResolvedValue(outcomeBase);
});

describe("buildOnSoporte", () => {
  it("crea el caso tipo soporte ANTES de invocar handleTurn (orden afirmado)", async () => {
    const db = openDatabase(":memory:");
    try {
      const order: string[] = [];
      mockedHandleTurn.mockImplementation(async (casoId) => {
        order.push(getCasoById(db, casoId) !== undefined ? "caso-existe:handleTurn" : "caso-ausente:handleTurn");
        return outcomeBase;
      });
      const newId = makeCounterNewId("caso");
      const handler = buildOnSoporte(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      await handler({ consulta: "¿Cómo cancelo mi cuenta?" });

      expect(order).toEqual(["caso-existe:handleTurn"]);

      const caso = getCasoById(db, "caso-1");
      expect(caso).toBeDefined();
      expect(caso?.tipo).toBe(CASO_TIPO_SOPORTE);
      expect(caso?.estado).toBe(CASO_ESTADO_ACTIVO);
    } finally {
      db.close();
    }
  });

  it("createKnowledge(casoId) se invoca UNA VEZ, con el casoId del turno recién creado", async () => {
    const db = openDatabase(":memory:");
    try {
      const newId = makeCounterNewId("caso");
      const createKnowledge = makeFakeKnowledge();
      const handler = buildOnSoporte(makeBaseDeps(db, { newId, createKnowledge, now: () => TIMESTAMP }));

      await handler({ consulta: "¿Cuándo llega mi pedido?" });

      expect(createKnowledge).toHaveBeenCalledTimes(1);
      expect(createKnowledge).toHaveBeenCalledWith("caso-1");
      // Cruzado: `handleTurn` debe haber recibido ese mismo `casoId` como
      // primer argumento posicional — confirma que es EL MISMO turno.
      expect(mockedHandleTurn.mock.calls[0]?.[0]).toBe("caso-1");
    } finally {
      db.close();
    }
  });

  it("propaga TurnFailedError — a diferencia de buildOnActivity, que traga", async () => {
    const db = openDatabase(":memory:");
    try {
      const error = new TurnFailedError("model", new Error("el modelo falló"));
      mockedHandleTurn.mockRejectedValueOnce(error);
      const handler = buildOnSoporte(makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }));

      await expect(handler({ consulta: "consulta cualquiera" })).rejects.toBe(error);
    } finally {
      db.close();
    }
  });

  it("propaga si createCaso falla (id duplicado) — sin llegar a invocar handleTurn una segunda vez", async () => {
    const db = openDatabase(":memory:");
    try {
      const newId = () => "caso-fijo";
      const handler = buildOnSoporte(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      await handler({ consulta: "primera consulta" });
      await expect(handler({ consulta: "segunda consulta" })).rejects.toThrow();

      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("reusa CONVERSATIONAL_AGENT vía candidateAgents: agents — sin agregar un segundo agente", async () => {
    const db = openDatabase(":memory:");
    try {
      const agents = [makeAgent("agente-conversacional")];
      const handler = buildOnSoporte(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, agents }),
      );

      await handler({ consulta: "consulta cualquiera" });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps?.candidateAgents).toBe(agents);
    } finally {
      db.close();
    }
  });

  it("construye el prompt vía buildSoportePrompt (PURA) — no un segundo AgentDefinition", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnSoporte(makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }));
      const consulta = "¿Puedo cambiar mi plan?";

      await handler({ consulta });

      expect(mockedHandleTurn.mock.calls[0]?.[1]).toBe(buildSoportePrompt(consulta));
    } finally {
      db.close();
    }
  });

  it("forwards mcpServers/knowledgeFeedback del KnowledgeAdapter de este turno", async () => {
    const db = openDatabase(":memory:");
    try {
      const fakeKnowledge: KnowledgeAdapter = {
        mcpServers: { knowledge: { type: "stdio", command: "graphify" } },
        feedback: {
          saveTurnResult: vi.fn().mockResolvedValue(undefined),
          discardPendingCitations: vi.fn(),
        },
      };
      const createKnowledge = vi.fn(() => fakeKnowledge);
      const handler = buildOnSoporte(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, createKnowledge }),
      );

      await handler({ consulta: "consulta cualquiera" });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps?.mcpServers).toBe(fakeKnowledge.mcpServers);
      expect(deps?.knowledgeFeedback).toBe(fakeKnowledge.feedback);
    } finally {
      db.close();
    }
  });

  it("omite logDeps de HandleTurnDeps cuando no se inyecta (exactOptionalPropertyTypes)", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnSoporte(makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }));

      await handler({ consulta: "consulta cualquiera" });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps).not.toHaveProperty("logDeps");
    } finally {
      db.close();
    }
  });

  it("forwarda logDeps a HandleTurnDeps cuando SÍ se inyecta", async () => {
    const db = openDatabase(":memory:");
    try {
      const logDeps = fakeLogDeps();
      const handler = buildOnSoporte(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      await handler({ consulta: "consulta cualquiera" });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps).toHaveProperty("logDeps", logDeps);
    } finally {
      db.close();
    }
  });

  it("loguea soporte-caso-creado con el casoId como correlación", async () => {
    const db = openDatabase(":memory:");
    try {
      const logDeps = fakeLogDeps();
      const handler = buildOnSoporte(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      await handler({ consulta: "consulta cualquiera" });

      const logged = parseLastLine(logDeps.lines);
      expect(logged.event).toBe("soporte-caso-creado");
      expect(logged.casoId).toBe("caso-1");
    } finally {
      db.close();
    }
  });

  it("devuelve {casoId, respuesta} con respuesta = result.responseText de handleTurn", async () => {
    const db = openDatabase(":memory:");
    try {
      mockedHandleTurn.mockResolvedValueOnce({
        responseText: "Podés cambiar tu plan desde la web.",
        agentLabel: "agente-conversacional",
      });
      const handler = buildOnSoporte(makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }));

      const result = await handler({ consulta: "¿Puedo cambiar mi plan?" });

      expect(result).toEqual({ casoId: "caso-1", respuesta: "Podés cambiar tu plan desde la web." });
    } finally {
      db.close();
    }
  });
});
