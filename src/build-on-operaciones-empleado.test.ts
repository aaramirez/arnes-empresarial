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
import type {
  AccionConfirmable,
  ConfirmacionOperacionPort,
  DominioConfirmacion,
} from "./core/operaciones/operaciones-contract.js";
import type { ConversacionEmpleadoPort } from "./core/conversacion/conversacion-contract.js";
import type { SesionEmpleado } from "./core/auth/sesion.js";
import { createSolicitudStore } from "./build-on-comando-empleado.js";
import { createVentaStore } from "./build-on-venta.js";
import { SOLICITUD_TIPO_GASTO } from "./core/solicitudes/solicitudes-contract.js";
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "./core/hitl/hitl-contract.js";
import type { LogTurnEventDeps } from "./core/logging/turn-logger.js";
import { VENTA_ESTADO_CONFIRMADA, type VentaNotifierPort } from "./core/ventas/ventas-contract.js";
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

/**
 * Molde EXACTO del doble de `ConfirmacionOperacionPort` de
 * `operaciones-contract.test.ts` — implementación REAL del predicado
 * `origenCasoId !== casoIdActual` (ADR 166 pto 3), no un `vi.fn()` fijo.
 * Necesario para el punto obligatorio 1 (tarea 3): probar que el invariante
 * de autoconfirmación sigue vivo con la memoria conversacional activa.
 *
 * `aprobacion-conversacional-hitl`, tarea 1/2: migrado a `LlaveConfirmacion`
 * (`dominio` + `itemId` + `accion`) — este archivo sólo ejercita
 * `cancelar_solicitud_interna`, así que la llave real es siempre
 * `{ dominio: DOMINIO_SOLICITUD, itemId: solicitudId, accion: "cancelar" }`.
 */
function realBehaviorConfirmacion(): ConfirmacionOperacionPort {
  let pendiente:
    | {
        dominio: DominioConfirmacion;
        itemId: string;
        accion: AccionConfirmable;
        empleadoId: string;
        casoId: string;
        origenCasoId: string;
      }
    | undefined;

  return {
    estaConfirmada: (llave, empleadoId, casoIdActual) =>
      pendiente !== undefined &&
      pendiente.dominio === llave.dominio &&
      pendiente.itemId === llave.itemId &&
      pendiente.accion === llave.accion &&
      pendiente.empleadoId === empleadoId &&
      pendiente.origenCasoId !== casoIdActual,
    marcarPendiente: (input) => {
      pendiente = { ...input };
    },
    consumir: () => {
      pendiente = undefined;
    },
  };
}

/** chat-web-empleado, tarea 3 — doble plano de `ConversacionEmpleadoPort` (ADR 196). */
function fakeConversacion(overrides: {
  readonly casoAnterior?: () => string | undefined;
  readonly registrarTurno?: (casoId: string) => void;
  readonly conversacionId?: () => string;
} = {}): ConversacionEmpleadoPort {
  return {
    casoAnterior: overrides.casoAnterior ?? (() => undefined),
    registrarTurno: overrides.registrarTurno ?? vi.fn(),
    conversacionId: overrides.conversacionId ?? (() => "conv-1"),
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
  readonly memory?: MemoryPort;
}

function makeBaseDeps(db: Database.Database, overrides: BaseDepsOverrides = {}): BuildOnOperacionesEmpleadoDeps {
  return {
    db,
    memory: overrides.memory ?? fakeMemory(),
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

      await handler({ consulta: "Cancelame la solicitud sol-1", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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

      await handler({ consulta, sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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
        handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() }),
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

      await handler({ consulta: "primera consulta", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });
      await expect(
        handler({ consulta: "segunda consulta", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() }),
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

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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

      await handler({ consulta: "consulta cualquiera", sesion: fakeSesion(), confirmacion: fakeConfirmacion(), conversacion: fakeConversacion() });

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
        conversacion: fakeConversacion(),
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

      await handler({ consulta: "Cancelame una solicitud", sesion, confirmacion, conversacion: fakeConversacion() });

      expect(capturedText).toBe("No tenés solicitudes pendientes para cancelar.");
      expect(confirmacion.estaConfirmada).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  /**
   * Hallazgo code-review post `devolucion-sin-token-dos-personas`: el
   * wiring de `consultaVentaPropia` (`toPortVentaPropia` +
   * `buscarVentaPropiaPorId`/`listVentasPropiasDeVendedor` reales, armado en
   * `buildOnOperacionesEmpleado`) no tenía ningún test que lo ejercitara —
   * molde EXACTO del test "wiring de extremo a extremo" de arriba, pero para
   * `consultar_venta` en vez de `cancelar_solicitud_interna`, con una venta
   * sembrada de verdad en SQLite vía `createVentaStore` (mismo store real
   * que usa el módulo bajo prueba internamente).
   */
  it("wiring de extremo a extremo: consultar_venta delega en consultaVentaPropia.buscarPorId/listarDeVendedor sobre datos reales", async () => {
    const db = openDatabase(":memory:");
    try {
      const ventaStore = createVentaStore(db);
      ventaStore.crearVentaConCaso({
        vendedor: { id: "empleado-1", nombre: "Empleado Uno" },
        caso: { id: "caso-venta-previo", tipo: "venta", estado: CASO_ESTADO_ACTIVO },
        venta: {
          id: "venta-propia-1",
          clienteId: "cliente-77",
          planNuevo: "plan-premium",
          monto: 1234,
          estado: VENTA_ESTADO_CONFIRMADA,
          tokenConfirmacion: "token-propia-1",
        },
        timestamp: TIMESTAMP,
      });

      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      let textoDetalle = "";
      let textoListado = "";
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

        const detalle = await registeredTool?.handler(
          { operacion: "consultar_venta", ventaId: "venta-propia-1" },
          {},
        );
        textoDetalle = detalle?.content[0]?.text ?? "";

        const listado = await registeredTool?.handler({ operacion: "consultar_venta" }, {});
        textoListado = listado?.content[0]?.text ?? "";

        return outcomeBase;
      });

      await handler({
        consulta: "¿Cómo está la venta venta-propia-1?",
        sesion: fakeSesion({ empleadoId: "empleado-1" }),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion(),
      });

      expect(textoDetalle).toContain("venta-propia-1");
      expect(textoDetalle).toContain("cliente-77");
      expect(textoDetalle).toContain("plan-premium");
      expect(textoDetalle).toContain(VENTA_ESTADO_CONFIRMADA);

      expect(textoListado).toContain("venta-propia-1");
      expect(textoListado).toContain("cliente-77");
    } finally {
      db.close();
    }
  });

  /**
   * Hallazgo code-review: `toPortVentaPropia` (armado en este módulo) lanza
   * `VentaEstadoInvalidoError` cuando `ventas.estado` no pertenece a
   * `VENTA_ESTADOS` — sin test hasta ahora. `ejecutarOperacion` atrapa
   * CUALQUIER error y lo traduce a texto degradado (molde documentado en su
   * propio archivo), así que el throw se verifica indirectamente: la
   * operación degrada Y el evento `operacion-fallida` logueado trae el
   * mensaje EXACTO de `VentaEstadoInvalidoError` (mismo criterio que el test
   * gemelo `VentaEstadoInvalidoError` de `build-on-venta.test.ts`: corrupción
   * real vía `UPDATE ventas SET estado = ...`, única forma de producir un
   * valor inválido sin pasar por ninguna validación de escritura).
   */
  it("toPortVentaPropia: fila con estado fuera de VENTA_ESTADOS degrada la operación y loguea VentaEstadoInvalidoError", async () => {
    const db = openDatabase(":memory:");
    try {
      const ventaStore = createVentaStore(db);
      ventaStore.crearVentaConCaso({
        vendedor: { id: "empleado-1", nombre: "Empleado Uno" },
        caso: { id: "caso-venta-corrupta", tipo: "venta", estado: CASO_ESTADO_ACTIVO },
        venta: {
          id: "venta-corrupta-1",
          clienteId: "cliente-99",
          planNuevo: "plan-x",
          monto: 500,
          estado: VENTA_ESTADO_CONFIRMADA,
          tokenConfirmacion: "token-corrupta-1",
        },
        timestamp: TIMESTAMP,
      });
      // Simula corrupción real (molde `build-on-venta.test.ts`): `ventas.estado`
      // es TEXT sin CHECK, así que escribir directo por SQL es la única forma
      // de producir un valor fuera de `VENTA_ESTADOS`.
      db.prepare("UPDATE ventas SET estado = ? WHERE id = ?").run("estado_invalido", "venta-corrupta-1");

      const logDeps = fakeLogDeps();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, logDeps }),
      );

      let texto = "";
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
        const resultado = await registeredTool?.handler(
          { operacion: "consultar_venta", ventaId: "venta-corrupta-1" },
          {},
        );
        texto = resultado?.content[0]?.text ?? "";
        return outcomeBase;
      });

      await handler({
        consulta: "¿Cómo está la venta venta-corrupta-1?",
        sesion: fakeSesion({ empleadoId: "empleado-1" }),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion(),
      });

      expect(texto).toBe("No se pudo completar la operación por un error interno. Contá con que no se aplicó nada e intentá de nuevo.");
      const logged = parseLastLine(logDeps.lines);
      expect(logged.event).toBe("operacion-fallida");
      expect(String(logged.message)).toContain("venta-corrupta-1 tiene estado inválido en la base: estado_invalido");
    } finally {
      db.close();
    }
  });
});

/**
 * chat-web-empleado, tarea 3 (ADR 196 ptos 5-9) — decorador de memoria
 * conversacional. `handleTurn` sigue MOCKEADO (molde del archivo, arriba):
 * se inspecciona el `memory` que el handler arma y le pasa a `handleTurn`
 * (`deps.memory` capturado de `mockedHandleTurn.mock.calls`), invocándolo
 * directamente para verificar la redirección — mismo criterio que las
 * aserciones ya existentes sobre `deps.candidateAgents`/`deps.mcpServers`.
 */
describe("buildOnOperacionesEmpleado — decorador de memoria conversacional (ADR 196)", () => {
  it("con casoAnterior() previo: getLatestSesionAgente se resuelve contra el caso ANTERIOR, no contra el del turno actual", async () => {
    const db = openDatabase(":memory:");
    try {
      const memoriaOriginal = fakeMemory();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, memory: memoriaOriginal }),
      );

      await handler({
        consulta: "consulta cualquiera",
        sesion: fakeSesion(),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ casoAnterior: () => "caso-anterior-fijo" }),
      });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      expect(deps).toBeDefined();
      deps?.memory.getLatestSesionAgente("caso-1", "agente-x");

      expect(memoriaOriginal.getLatestSesionAgente).toHaveBeenCalledWith("caso-anterior-fijo", "agente-x");
    } finally {
      db.close();
    }
  });

  it("sin casoAnterior() previo: la redirección delega en el MISMO casoId del turno (no en 'caso-anterior-fijo')", async () => {
    const db = openDatabase(":memory:");
    try {
      const memoriaOriginal = fakeMemory();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, memory: memoriaOriginal }),
      );

      await handler({
        consulta: "consulta cualquiera",
        sesion: fakeSesion(),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ casoAnterior: () => undefined }),
      });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      deps?.memory.getLatestSesionAgente("caso-1", "agente-x");

      expect(memoriaOriginal.getLatestSesionAgente).toHaveBeenCalledWith("caso-1", "agente-x");
    } finally {
      db.close();
    }
  });

  it("getCasoById/updateCaso/createSesionAgente delegan SIN redirigir (único método redirigido: getLatestSesionAgente)", async () => {
    const db = openDatabase(":memory:");
    try {
      const memoriaOriginal = fakeMemory();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, memory: memoriaOriginal }),
      );

      await handler({
        consulta: "consulta cualquiera",
        sesion: fakeSesion(),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ casoAnterior: () => "caso-anterior-fijo" }),
      });

      const deps = mockedHandleTurn.mock.calls[0]?.[2];
      deps?.memory.getCasoById("caso-1");
      deps?.memory.updateCaso("caso-1", { estado: "cerrado", updatedAt: TIMESTAMP });
      deps?.memory.createSesionAgente({
        id: "sa-1",
        casoId: "caso-1",
        agentId: "agente-x",
        sdkSessionId: "sdk-1",
        createdAt: TIMESTAMP,
      });

      expect(memoriaOriginal.getCasoById).toHaveBeenCalledWith("caso-1");
      expect(memoriaOriginal.updateCaso).toHaveBeenCalledWith("caso-1", { estado: "cerrado", updatedAt: TIMESTAMP });
      expect(memoriaOriginal.createSesionAgente).toHaveBeenCalledWith({
        id: "sa-1",
        casoId: "caso-1",
        agentId: "agente-x",
        sdkSessionId: "sdk-1",
        createdAt: TIMESTAMP,
      });
    } finally {
      db.close();
    }
  });

  it("un turno EXITOSO llama registrarTurno(casoId) DESPUÉS de que handleTurn resolvió", async () => {
    const db = openDatabase(":memory:");
    try {
      const order: string[] = [];
      mockedHandleTurn.mockImplementation(async () => {
        order.push("handleTurn-resuelto");
        return outcomeBase;
      });
      const registrarTurno = vi.fn((casoId: string) => {
        order.push(`registrarTurno:${casoId}`);
      });
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await handler({
        consulta: "consulta cualquiera",
        sesion: fakeSesion(),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ registrarTurno }),
      });

      expect(registrarTurno).toHaveBeenCalledWith("caso-1");
      expect(order).toEqual(["handleTurn-resuelto", "registrarTurno:caso-1"]);
    } finally {
      db.close();
    }
  });

  it("un turno FALLIDO nunca llama registrarTurno — la memoria no avanza (ADR 196 pto 7)", async () => {
    const db = openDatabase(":memory:");
    try {
      const error = new TurnFailedError("model", new Error("el modelo falló"));
      mockedHandleTurn.mockRejectedValueOnce(error);
      const registrarTurno = vi.fn();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      await expect(
        handler({
          consulta: "consulta cualquiera",
          sesion: fakeSesion(),
          confirmacion: fakeConfirmacion(),
          conversacion: fakeConversacion({ registrarTurno }),
        }),
      ).rejects.toBe(error);

      expect(registrarTurno).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("dos ConversacionEmpleadoPort distintos (dos tokens simulados) nunca cruzan su resolución de resume", async () => {
    const db = openDatabase(":memory:");
    try {
      const memoriaOriginal = fakeMemory();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP, memory: memoriaOriginal }),
      );

      await handler({
        consulta: "consulta del empleado A",
        sesion: fakeSesion({ empleadoId: "empleado-A" }),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ casoAnterior: () => "caso-A-anterior" }),
      });
      const depsA = mockedHandleTurn.mock.calls[0]?.[2];
      depsA?.memory.getLatestSesionAgente("caso-2", "agente-x");

      await handler({
        consulta: "consulta del empleado B",
        sesion: fakeSesion({ empleadoId: "empleado-B" }),
        confirmacion: fakeConfirmacion(),
        conversacion: fakeConversacion({ casoAnterior: () => "caso-B-anterior" }),
      });
      const depsB = mockedHandleTurn.mock.calls[1]?.[2];
      depsB?.memory.getLatestSesionAgente("caso-3", "agente-x");

      expect(memoriaOriginal.getLatestSesionAgente).toHaveBeenNthCalledWith(1, "caso-A-anterior", "agente-x");
      expect(memoriaOriginal.getLatestSesionAgente).toHaveBeenNthCalledWith(2, "caso-B-anterior", "agente-x");
    } finally {
      db.close();
    }
  });
});

/**
 * chat-web-empleado, tarea 3 — punto obligatorio 1 (R1, el riesgo
 * estructural del change): con memoria conversacional activa, dos
 * invocaciones de `cancelar_solicitud_interna` DENTRO DEL MISMO mensaje
 * (mismo `casoId`, ergo mismo `handleTurn`) siguen sin poder
 * autoconfirmarse. Usa `realBehaviorConfirmacion()` (predicado real, no un
 * `vi.fn()` fijo) y una solicitud sembrada de verdad en SQLite en memoria
 * vía `createSolicitudStore` (mismo store real que usa el módulo bajo
 * prueba internamente).
 */
describe("buildOnOperacionesEmpleado — autoconfirmación imposible con memoria activa (ADR 189 pto 4, punto obligatorio 1)", () => {
  it("dos invocaciones de cancelar_solicitud_interna en el MISMO mensaje: la segunda NO confirma la primera", async () => {
    const db = openDatabase(":memory:");
    try {
      const solicitudStore = createSolicitudStore(db);
      const solicitud = solicitudStore.crearSolicitudConCaso({
        caso: { id: "caso-solicitud-previo", tipo: "solicitud", estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
        solicitud: {
          id: "sol-1",
          solicitanteId: "empleado-1",
          tipo: SOLICITUD_TIPO_GASTO,
          detalle: "taxi al cliente",
          estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
        },
        timestamp: TIMESTAMP,
      });
      expect(solicitud.id).toBe("sol-1");

      const confirmacion = realBehaviorConfirmacion();
      const handler = buildOnOperacionesEmpleado(
        makeBaseDeps(db, { newId: makeCounterNewId("caso"), now: () => TIMESTAMP }),
      );

      const textos: string[] = [];
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

        // Primera invocación: PROPONE la cancelación (marcarPendiente, origenCasoId = casoId de ESTE turno).
        const primera = await registeredTool?.handler(
          { operacion: "cancelar_solicitud_interna", solicitudId: "sol-1" },
          {},
        );
        textos.push(primera?.content[0]?.text ?? "");

        // Segunda invocación, DENTRO DEL MISMO MENSAJE (mismo casoId): intenta confirmar lo que la primera propuso.
        const segunda = await registeredTool?.handler(
          { operacion: "cancelar_solicitud_interna", solicitudId: "sol-1" },
          {},
        );
        textos.push(segunda?.content[0]?.text ?? "");

        return outcomeBase;
      });

      await handler({
        consulta: "Cancelá la solicitud sol-1",
        sesion: fakeSesion({ empleadoId: "empleado-1" }),
        confirmacion,
        conversacion: fakeConversacion(),
      });

      // Las DOS respuestas piden confirmación — NINGUNA ejecuta la cancelación (autoconfirmación estructuralmente imposible).
      expect(textos[0]).toContain("Confirmá");
      expect(textos[1]).toContain("Confirmá");
      expect(solicitudStore.listarSolicitudesPendientes({ solicitudId: "sol-1" })[0]?.estado).toBe(
        CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
      );
    } finally {
      db.close();
    }
  });

  it("propuesta en el turno N, confirmación en el turno N+1 (memoria activa entre ambos) SIGUE confirmando", async () => {
    const db = openDatabase(":memory:");
    try {
      const solicitudStore = createSolicitudStore(db);
      solicitudStore.crearSolicitudConCaso({
        caso: { id: "caso-solicitud-previo-2", tipo: "solicitud", estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
        solicitud: {
          id: "sol-2",
          solicitanteId: "empleado-1",
          tipo: SOLICITUD_TIPO_GASTO,
          detalle: "taxi al cliente",
          estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
        },
        timestamp: TIMESTAMP,
      });

      const confirmacion = realBehaviorConfirmacion();
      const newId = makeCounterNewId("caso");
      const handler = buildOnOperacionesEmpleado(makeBaseDeps(db, { newId, now: () => TIMESTAMP }));
      const conversacion = fakeConversacion();

      // Turno N: propone.
      let textoTurnoN = "";
      mockedHandleTurn.mockImplementationOnce(async (_casoId, _prompt, deps) => {
        const server = deps.mcpServers?.[OPERACIONES_MCP_SERVER_NAME] as unknown as {
          readonly instance: {
            readonly _registeredTools: Record<
              string,
              { readonly handler: (args: unknown, extra: unknown) => Promise<{ content: [{ text: string }] }> }
            >;
          };
        };
        const registeredTool = server.instance._registeredTools["operacion_negocio"];
        const resultado = await registeredTool?.handler(
          { operacion: "cancelar_solicitud_interna", solicitudId: "sol-2" },
          {},
        );
        textoTurnoN = resultado?.content[0]?.text ?? "";
        return outcomeBase;
      });
      await handler({ consulta: "Cancelá sol-2", sesion: fakeSesion({ empleadoId: "empleado-1" }), confirmacion, conversacion });
      expect(textoTurnoN).toContain("Confirmá");

      // Turno N+1: confirma (mensaje POSTERIOR y DISTINTO — casoId nuevo).
      let textoTurnoN1 = "";
      mockedHandleTurn.mockImplementationOnce(async (_casoId, _prompt, deps) => {
        const server = deps.mcpServers?.[OPERACIONES_MCP_SERVER_NAME] as unknown as {
          readonly instance: {
            readonly _registeredTools: Record<
              string,
              { readonly handler: (args: unknown, extra: unknown) => Promise<{ content: [{ text: string }] }> }
            >;
          };
        };
        const registeredTool = server.instance._registeredTools["operacion_negocio"];
        const resultado = await registeredTool?.handler(
          { operacion: "cancelar_solicitud_interna", solicitudId: "sol-2" },
          {},
        );
        textoTurnoN1 = resultado?.content[0]?.text ?? "";
        return outcomeBase;
      });
      await handler({ consulta: "Sí, confirmalo", sesion: fakeSesion({ empleadoId: "empleado-1" }), confirmacion, conversacion });

      expect(textoTurnoN1).not.toContain("Confirmá");
      expect(solicitudStore.listarSolicitudesPendientes({ solicitudId: "sol-2" })).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
