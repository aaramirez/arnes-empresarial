/**
 * Tests for `buildOnOperacionesEmpleado` (`operaciones-negocio-conversacionales`,
 * tarea 5, ADR 167/172/173). Molde EXACTO de `build-on-soporte.test.ts` (ver
 * su propio module doc para el razonamiento completo de `vi.mock` sobre
 * `handle-turn.js` y de `openDatabase(":memory:")` real para probar el
 * orden `createCaso` → `handleTurn`) — este archivo cubre además el wiring
 * propio de este módulo: `candidateAgents: [construirAgenteEmpleadoOperaciones()]`
 * (lista de UN elemento, nunca `AGENT_REGISTRY`), el prompt vía
 * `buildOperacionesEmpleadoPrompt` (PURA), y que el `mcpServers` que llega a
 * `handleTurn` es el de la tool `operaciones` (nunca la de conocimiento —
 * `BuildOnOperacionesEmpleadoDeps` no recibe `createKnowledge`).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  buildOnOperacionesEmpleado,
  type BuildOnOperacionesEmpleadoDeps,
} from "./build-on-operaciones-empleado.js";
import { construirAgenteEmpleadoOperaciones } from "./core/agents/definitions.js";
import { buildOperacionesEmpleadoPrompt } from "./core/ventas/soporte-prompt.js";
import { TurnFailedError } from "./core/turn-selector/turn-error.js";
import { createHookEngine } from "./core/hooks/hook-engine.js";
import { openDatabase } from "./adapters/memory/db.js";
import { getCasoById } from "./adapters/memory/repository.js";
import type { MemoryPort } from "./core/turn-selector/handle-turn.js";
import { OPERACIONES_MCP_SERVER_NAME } from "./core/operaciones/operaciones-contract.js";
import type { ConfirmacionOperacionPort } from "./core/operaciones/operaciones-contract.js";
import type { SesionEmpleado } from "./core/auth/sesion.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { VentaNotifierPort } from "./core/ventas/ventas-contract.js";
import type { VentasConfig } from "./core/ventas/ventas-config.js";
import type { DespacharDelegacionDeps } from "./core/turn-selector/dispatch-delegation.js";

vi.mock("./core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

import { handleTurn } from "./core/turn-selector/handle-turn.js";

const mockedHandleTurn = vi.mocked(handleTurn);

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const CASO_ESTADO_ACTIVO = "activo";

const outcomeBase = { responseText: "Respuesta del turno de operaciones.", agentLabel: "agente-conversacional" };

function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn(),
    getLatestSesionAgente: vi.fn(),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

function fakeSesion(overrides: Partial<SesionEmpleado> = {}): SesionEmpleado {
  return { empleadoId: "empleado-1", iniciadaEn: TIMESTAMP, ...overrides };
}

function fakeConfirmacion(): ConfirmacionOperacionPort {
  return {
    estaConfirmada: vi.fn().mockReturnValue(false),
    marcarPendiente: vi.fn(),
    consumir: vi.fn(),
  };
}

function fakeVentasConfig(): VentasConfig {
  return {
    comisionPorcentaje: 0.1,
    reembolsoUmbral: 500,
    tokenTtlHoras: 72,
    ventaGrandeUmbral: 5_000,
  };
}

function fakeNotifier(): VentaNotifierPort {
  return { notificarLinkConfirmacion: vi.fn().mockResolvedValue({ enviado: true }) };
}

function fakeDespacharDeps(): DespacharDelegacionDeps {
  return {
    store: { crearDelegacion: vi.fn(), completarDelegacion: vi.fn() },
    invocar: vi.fn(),
    getSubagente: vi.fn(),
    newId: makeCounterNewId("delegacion"),
    now: () => TIMESTAMP,
    logEvent: vi.fn(),
  };
}

/** Captura líneas en memoria — mismo criterio que `build-on-soporte.test.ts`. */
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
  readonly newId?: () => string;
  readonly newToken?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
}

function makeBaseDeps(db: Database.Database, overrides: BaseDepsOverrides = {}): BuildOnOperacionesEmpleadoDeps {
  return {
    db,
    memory: fakeMemory(),
    hooks: createHookEngine(),
    ventasConfig: fakeVentasConfig(),
    notifier: fakeNotifier(),
    baseUrlPublica: "https://arnes.example.test",
    despacharDeps: fakeDespacharDeps(),
    ...(overrides.newId ? { newId: overrides.newId } : {}),
    ...(overrides.newToken ? { newToken: overrides.newToken } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.logDeps ? { logDeps: overrides.logDeps } : {}),
  };
}

beforeEach(() => {
  mockedHandleTurn.mockReset();
  mockedHandleTurn.mockResolvedValue(outcomeBase);
});

describe("buildOnOperacionesEmpleado", () => {
  it("crea el caso ANTES de invocar handleTurn (orden afirmado)", async () => {
    const db = openDatabase(":memory:");
    try {
      const order: string[] = [];
      mockedHandleTurn.mockImplementation(async (casoId) => {
        order.push(getCasoById(db, casoId) !== undefined ? "caso-existe:handleTurn" : "caso-ausente:handleTurn");
        return outcomeBase;
      });
      const newId = makeCounterNewId("caso");
      const handler = buildOnOperacionesEmpleado(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      await handler({ consulta: "Cancelame la solicitud sol-1", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      expect(order).toEqual(["caso-existe:handleTurn"]);

      const caso = getCasoById(db, "caso-1");
      expect(caso).toBeDefined();
      expect(caso?.estado).toBe(CASO_ESTADO_ACTIVO);
    } finally {
      db.close();
    }
  });

  it("arma candidateAgents con UN solo elemento: construirAgenteEmpleadoOperaciones() — nunca AGENT_REGISTRY", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps?.candidateAgents).toHaveLength(1);
      expect(deps?.candidateAgents[0]).toEqual(construirAgenteEmpleadoOperaciones());
    } finally {
      db.close();
    }
  });

  it("construye el prompt vía buildOperacionesEmpleadoPrompt (PURA) — no via buildSoportePrompt", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );
      const consulta = "Registrame una venta de 500 para el cliente 123";

      await handler({ consulta, sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      expect(mockedHandleTurn.mock.calls[0]?.[1]).toBe(buildOperacionesEmpleadoPrompt(consulta));
    } finally {
      db.close();
    }
  });

  it("pasa mcpServers con la tool de operaciones registrada (nunca la de conocimiento)", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(Object.keys(deps?.mcpServers ?? {})).toEqual([OPERACIONES_MCP_SERVER_NAME]);
    } finally {
      db.close();
    }
  });

  it("propaga TurnFailedError — agnóstico del caller, igual que buildOnSoporte", async () => {
    const db = openDatabase(":memory:");
    try {
      const error = new TurnFailedError("model", new Error("el modelo falló"));
      mockedHandleTurn.mockRejectedValueOnce(error);
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await expect(
        handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() }),
      ).rejects.toBe(error);
    } finally {
      db.close();
    }
  });

  it("propaga si createCaso falla (id duplicado) — sin invocar handleTurn una segunda vez", async () => {
    const db = openDatabase(":memory:");
    try {
      const newId = () => "caso-fijo";
      const handler = buildOnOperacionesEmpleado(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));

      await handler({ consulta: "primera consulta", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });
      await expect(
        handler({ consulta: "segunda consulta", sesion: fakeSesion(), confirmacion: fakeConfirmacion() }),
      ).rejects.toThrow();

      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("omite logDeps de HandleTurnDeps cuando no se inyecta (exactOptionalPropertyTypes)", async () => {
    const db = openDatabase(":memory:");
    try {
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

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
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      expect(deps).toHaveProperty("logDeps", logDeps);
    } finally {
      db.close();
    }
  });

  it("loguea la creación del caso con el casoId como correlación", async () => {
    const db = openDatabase(":memory:");
    try {
      const logDeps = fakeLogDeps();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion() });

      const logged = parseLastLine(logDeps.lines);
      expect(logged.casoId).toBe("caso-1");
    } finally {
      db.close();
    }
  });

  it("devuelve {casoId, respuesta} con respuesta = result.responseText de handleTurn", async () => {
    const db = openDatabase(":memory:");
    try {
      mockedHandleTurn.mockResolvedValueOnce({
        responseText: "Venta registrada con éxito.",
        agentLabel: "agente-conversacional",
      });
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      const result = await handler({
        consulta: "Registrame una venta",
        sesion: fakeSesion(),
        confirmacion: fakeConfirmacion(),
      });

      expect(result).toEqual({ casoId: "caso-1", respuesta: "Venta registrada con éxito." });
    } finally {
      db.close();
    }
  });

  it("wiring de extremo a extremo: la tool registrada delega en ejecutarOperacion con la sesion/confirmacion/casoId del turno (cancelar_solicitud_interna, listado sin solicitudId)", async () => {
    const db = openDatabase(":memory:");
    try {
      const sesion = fakeSesion({ empleadoId: "empleado-99" });
      const confirmacion = fakeConfirmacion();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      let capturedText = "";
      mockedHandleTurn.mockImplementation(async (_casoId, _prompt, deps) => {
        const server = deps.mcpServers?.[OPERACIONES_MCP_SERVER_NAME] as unknown as {
          readonly instance: {
            readonly _registeredTools: Record<
              string,
              { readonly handler: (args: unknown, extra: unknown) => Promise<{ content: [{ text: string }] }> }
            >;
          };
        };
        const registeredTool = server.instance._registeredTools["operacion_negocio"];
        const result = await registeredTool?.handler(
          { operacion: "cancelar_solicitud_interna" },
          {},
        );
        capturedText = result?.content[0]?.text ?? "";
        return outcomeBase;
      });

      await handler({ consulta: "Cancelame una solicitud", sesion, confirmacion });

      expect(capturedText).toBe("No tenés solicitudes pendientes para cancelar.");
      expect(confirmacion.estaConfirmada).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
