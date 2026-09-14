/**
 * Tests for `buildOnA2AEntrante` — ver el module doc de `build-on-a2a-entrante.ts`
 * para el contrato completo (Hito 7, tarea 15, spec `solicitud-a2a-entrante`).
 *
 * Molde EXACTO de `build-on-soporte.test.ts`: `handle-turn.js` se mockea
 * ENTERO (`vi.mock`), y `createCaso`/`insertSolicitudA2AEntrante`/etc. se
 * ejercitan contra un `openDatabase(":memory:")` REAL — un SQLite real es la
 * única forma honesta de probar el orden `insertSolicitudA2AEntrante` →
 * `handleTurn`: consultar `getSolicitudA2AEntrantePorTaskId` DENTRO del mock
 * de `handleTurn` es una señal real de secuencia de ejecución, no una
 * suposición de timing artificial (mismo criterio que
 * `build-on-soporte.test.ts` ya documenta para `getCasoById`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  buildOnA2AEntrante,
  CASO_TIPO_A2A_ENTRANTE,
  type BuildOnA2AEntranteDeps,
} from "./build-on-a2a-entrante.js";
import {
  TASK_STATE_CANCELED,
  TASK_STATE_FAILED,
  TASK_STATE_REJECTED,
  TASK_STATE_SUBMITTED,
} from "./core/agents/a2a-contract.js";
import { buildSolicitudA2APrompt } from "./core/agents/a2a-entrante-prompt.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import { DEFAULT_AGENT_MODEL, type AgentDefinition } from "./core/agents/definitions.js";
import { openDatabase } from "./adapters/memory/db.js";
import {
  getCasoById,
  getSolicitudA2AEntrantePorTaskId,
  insertSolicitudA2AEntrante,
} from "./adapters/memory/repository.js";
import type { MemoryPort, HandleTurnResult } from "./core/turn-selector/handle-turn.js";
import type { KnowledgeAdapter } from "./adapters/knowledge/index.js";
import type { ConsultasNegocioAdapter } from "./adapters/consultas/index.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";

vi.mock("./core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

import { handleTurn } from "./core/turn-selector/handle-turn.js";

const mockedHandleTurn = vi.mocked(handleTurn);

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const CASO_ESTADO_ACTIVO = "activo";

const outcomeBase: HandleTurnResult = {
  responseText: "Respuesta del agente A2A.",
  agentLabel: "agente-conversacional",
};

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
    description: "agente de prueba",
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

/** Molde EXACTO de `makeFakeKnowledge` — noveno campo (ADR 174, tarea 7). Sin `feedback` (ADR 181). */
function makeFakeConsultas(): (casoId: string) => ConsultasNegocioAdapter {
  return vi.fn((): ConsultasNegocioAdapter => ({ mcpServers: {} }));
}

/** Captura líneas en memoria en vez de tocar el filesystem real — mismo criterio que `build-on-soporte.test.ts`. */
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

function parsedLines(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function makeCounterNewId(prefix = "id"): () => string {
  let contador = 0;
  return () => `${prefix}-${++contador}`;
}

interface BaseDepsOverrides {
  readonly createKnowledge?: (casoId: string) => KnowledgeAdapter;
  readonly createConsultas?: (casoId: string) => ConsultasNegocioAdapter;
  readonly newId?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
  readonly agents?: readonly AgentDefinition[];
}

function makeBaseDeps(db: Database.Database, overrides: BaseDepsOverrides = {}): BuildOnA2AEntranteDeps {
  return {
    db,
    memory: fakeMemory(),
    hooks: createHookEngine(),
    agents: overrides.agents ?? [makeAgent("agente-conversacional")],
    createKnowledge: overrides.createKnowledge ?? makeFakeKnowledge(),
    createConsultas: overrides.createConsultas ?? makeFakeConsultas(),
    ...(overrides.newId ? { newId: overrides.newId } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.logDeps ? { logDeps: overrides.logDeps } : {}),
  };
}

beforeEach(() => {
  mockedHandleTurn.mockReset();
  mockedHandleTurn.mockResolvedValue(outcomeBase);
});

describe("buildOnA2AEntrante — onSolicitudA2A", () => {
  it("crea el caso tipo a2a_entrante y la fila EXISTE antes de que la promesa de onSolicitudA2A resuelva (orden afirmado)", async () => {
    const db = openDatabase(":memory:");
    try {
      const order: string[] = [];
      mockedHandleTurn.mockImplementation(async () => {
        const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
        order.push(fila !== undefined ? "fila-existe:handleTurn" : "fila-ausente:handleTurn");
        return outcomeBase;
      });
      const newId = makeCounterNewId("caso");
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      const resultado = await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "¿Cuál es el estado del pedido 123?",
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });

      expect(order).toEqual(["fila-existe:handleTurn"]);
      expect(resultado.estado).toBe(TASK_STATE_SUBMITTED);

      const caso = getCasoById(db, "caso-1");
      expect(caso).toBeDefined();
      expect(caso?.tipo).toBe(CASO_TIPO_A2A_ENTRANTE);
      expect(caso?.estado).toBe(CASO_ESTADO_ACTIVO);

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila?.casoId).toBe("caso-1");
      expect(fila?.origenTransporte).toBe("203.0.113.5");
    } finally {
      db.close();
    }
  });

  it("createKnowledge(casoId) se invoca UNA VEZ, con el casoId del turno recién creado", async () => {
    const db = openDatabase(":memory:");
    try {
      const newId = makeCounterNewId("caso");
      const createKnowledge = makeFakeKnowledge();
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId, createKnowledge, now: () => TIMESTAMP }));

      await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "¿Cuándo llega mi pedido?",
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });

      expect(createKnowledge).toHaveBeenCalledTimes(1);
      expect(createKnowledge).toHaveBeenCalledWith("caso-1");
      expect(mockedHandleTurn.mock.calls[0]?.[0]).toBe("caso-1");
    } finally {
      db.close();
    }
  });

  it("handleTurn recibe el prompt de buildSolicitudA2APrompt", async () => {
    const db = openDatabase(":memory:");
    try {
      const handlers = buildOnA2AEntrante(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );
      const texto = "¿Puedo cambiar mi plan?";

      await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto,
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });

      expect(mockedHandleTurn.mock.calls[0]?.[1]).toBe(buildSolicitudA2APrompt(texto));
    } finally {
      db.close();
    }
  });

  it("cuando handleTurn rechaza, la fila queda FAILED y la promesa `turno` NO rechaza", async () => {
    const db = openDatabase(":memory:");
    try {
      mockedHandleTurn.mockRejectedValueOnce(new Error("el modelo falló"));
      const logDeps = fakeLogDeps();
      const handlers = buildOnA2AEntrante(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      const resultado = await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "consulta cualquiera",
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });

      expect(resultado.estado).toBe(TASK_STATE_SUBMITTED);
      if (resultado.estado !== TASK_STATE_SUBMITTED) {
        throw new Error("unreachable");
      }
      await expect(resultado.turno).resolves.toBeUndefined();

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila?.estado).toBe(TASK_STATE_FAILED);

      const eventos = parsedLines(logDeps.lines);
      expect(eventos.some((e) => e.event === "a2a-turno-entrante-fallido")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("hayCupo === false ⇒ createCaso cero llamadas, sin caso, sin turno, sin modelo", async () => {
    const db = openDatabase(":memory:");
    try {
      const logDeps = fakeLogDeps();
      const handlers = buildOnA2AEntrante(
        makeBaseDeps(db, { newId: makeCounterNewId("id"), now: () => TIMESTAMP, logDeps }),
      );

      const resultado = await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "consulta cualquiera",
        origenTransporte: "203.0.113.5",
        hayCupo: false,
      });

      expect(resultado).toEqual({
        estado: TASK_STATE_REJECTED,
        contextId: "task-1",
        updatedAt: TIMESTAMP,
      });
      expect("turno" in resultado).toBe(false);
      expect(mockedHandleTurn).not.toHaveBeenCalled();

      const countCasos = db.prepare("SELECT COUNT(*) as c FROM casos").get() as { c: number };
      expect(countCasos.c).toBe(0);

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila).toBeDefined();
      expect(fila?.estado).toBe(TASK_STATE_REJECTED);
      expect(fila?.casoId).toBeUndefined();

      const eventos = parsedLines(logDeps.lines);
      expect(eventos.some((e) => e.event === "a2a-solicitud-rechazada-tope")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("CancelTask mientras handleTurn está pendiente ⇒ la fila queda CANCELED, el resultado se descarta (a2a-turno-entrante-descartado)", async () => {
    const db = openDatabase(":memory:");
    try {
      let resolverHandleTurn!: (value: HandleTurnResult) => void;
      const pendiente = new Promise<HandleTurnResult>((resolve) => {
        resolverHandleTurn = resolve;
      });
      mockedHandleTurn.mockReturnValueOnce(pendiente);

      const logDeps = fakeLogDeps();
      const handlers = buildOnA2AEntrante(
        makeBaseDeps(db, { newId: makeCounterNewId("id"), now: () => TIMESTAMP, logDeps }),
      );

      const resultado = await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "consulta cualquiera",
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });
      expect(resultado.estado).toBe(TASK_STATE_SUBMITTED);
      if (resultado.estado !== TASK_STATE_SUBMITTED) {
        throw new Error("unreachable");
      }

      // CancelTask llega MIENTRAS el turno está corriendo (fila en WORKING).
      const cancelacion = handlers.onCancelarTarea("task-1");
      expect(cancelacion.resultado).toBe("cancelada");

      resolverHandleTurn(outcomeBase);
      await resultado.turno;

      const fila = getSolicitudA2AEntrantePorTaskId(db, "task-1");
      expect(fila?.estado).toBe(TASK_STATE_CANCELED);
      expect(fila?.resultado).toBeUndefined();

      const eventos = parsedLines(logDeps.lines);
      expect(eventos.some((e) => e.event === "a2a-turno-entrante-descartado")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("si insertSolicitudA2AEntrante falla (colisión real de a2a_task_id), el caso recién creado NO queda insertado — rollback real de la transacción, no sólo la promesa rechazada (Hallazgo 4 Reviewer, Hito 7)", async () => {
    const db = openDatabase(":memory:");
    try {
      // Fila preexistente con el MISMO `a2aTaskId`: la segunda inserción que
      // hace `onSolicitudA2A` (ya con un `casoId` nuevo) choca contra la
      // constraint `UNIQUE(a2a_task_id)` — un fallo REAL de SQLite
      // (`SolicitudA2AEntranteYaExisteError`), no un doble/mock inyectado.
      insertSolicitudA2AEntrante(db, {
        id: "fila-previa",
        a2aTaskId: "task-duplicado",
        origenTransporte: "203.0.113.5",
        mensajeRecibido: "ya existe",
        estado: TASK_STATE_SUBMITTED,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      });

      const newId = makeCounterNewId("caso");
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      await expect(
        handlers.onSolicitudA2A({
          a2aTaskId: "task-duplicado",
          texto: "consulta cualquiera",
          origenTransporte: "203.0.113.5",
          hayCupo: true,
        }),
      ).rejects.toThrow();

      // `newId` es un contador determinista: el primer valor que
      // `onSolicitudA2A` pide es el `casoId` — "caso-1". Sin la
      // transacción, ese `caso` sobrevivía huérfano pese al `INSERT`
      // fallido de `solicitudes_a2a_entrantes`.
      expect(getCasoById(db, "caso-1")).toBeUndefined();

      const countCasos = db.prepare("SELECT COUNT(*) as c FROM casos").get() as { c: number };
      expect(countCasos.c).toBe(0);
      expect(mockedHandleTurn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});

describe("buildOnA2AEntrante — onConsultarTarea / onCancelarTarea (síncronos)", () => {
  it("onConsultarTarea de un id inexistente ⇒ undefined", () => {
    const db = openDatabase(":memory:");
    try {
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId: makeCounterNewId("id"), now: () => TIMESTAMP }));
      expect(handlers.onConsultarTarea("no-existe")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("onCancelarTarea de un id inexistente ⇒ { resultado: 'no-encontrada' }, sin vista", () => {
    const db = openDatabase(":memory:");
    try {
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId: makeCounterNewId("id"), now: () => TIMESTAMP }));
      expect(handlers.onCancelarTarea("no-existe")).toEqual({ resultado: "no-encontrada" });
    } finally {
      db.close();
    }
  });

  it("onCancelarTarea sobre una solicitud COMPLETED ⇒ 'no-cancelable', la fila no se toca", async () => {
    const db = openDatabase(":memory:");
    try {
      const handlers = buildOnA2AEntrante(makeBaseDeps(db, { newId: makeCounterNewId("id"), now: () => TIMESTAMP }));

      const resultado = await handlers.onSolicitudA2A({
        a2aTaskId: "task-1",
        texto: "consulta cualquiera",
        origenTransporte: "203.0.113.5",
        hayCupo: true,
      });
      if (resultado.estado !== TASK_STATE_SUBMITTED) {
        throw new Error("unreachable");
      }
      await resultado.turno;

      const cancelacion = handlers.onCancelarTarea("task-1");
      expect(cancelacion.resultado).toBe("no-cancelable");
    } finally {
      db.close();
    }
  });
});

describe("buildOnA2AEntrante — límite estructural (ADR 98, enmendado por ADR 174)", () => {
  it("BuildOnA2AEntranteDeps tiene EXACTAMENTE nueve campos, ninguno puerto de escritura (consultas-negocio-a2a-entrante, tarea 7)", () => {
    const source = readFileSync(new URL("./build-on-a2a-entrante.ts", import.meta.url), "utf8");

    const interfaceMatch = source.match(/export interface BuildOnA2AEntranteDeps \{([\s\S]*?)\n\}/);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch?.[1] ?? "";

    const campos = Array.from(body.matchAll(/readonly (\w+)\??:/g)).map((m) => m[1]).sort();
    expect(campos).toEqual(
      ["agents", "createConsultas", "createKnowledge", "db", "hooks", "logDeps", "memory", "newId", "now"].sort(),
    );

    // Escaneamos los `import ... from "..."` reales, no comentarios que
    // MENCIONEN estos nombres para documentar por qué el módulo no los usa.
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");

    // Los ocho puertos de escritura de la tabla del ADR 98 pto 2 — ninguno
    // puede colarse ni siquiera como import de tipo.
    expect(importLines).not.toMatch(/\bboard\b/i);
    expect(importLines).not.toMatch(/ActivityStorePort/);
    expect(importLines).not.toMatch(/ActivityBoardPort/);
    expect(importLines).not.toMatch(/escritura/i);
    expect(importLines).not.toMatch(/WorktreePort/);
    expect(importLines).not.toMatch(/ClienteA2APort/);
    expect(importLines).not.toMatch(/\bnotifier\b/i);
    expect(importLines).not.toMatch(/VentaStorePort/);
    expect(importLines).not.toMatch(/SolicitudStorePort/);
    expect(importLines).not.toMatch(/KeyedQueue/);
    expect(importLines).not.toMatch(/adapters\/a2a\/client/);
    expect(importLines).not.toMatch(/adapters\/web\//);
    expect(importLines).not.toMatch(/adapters\/webhooks\//);
  });
});
