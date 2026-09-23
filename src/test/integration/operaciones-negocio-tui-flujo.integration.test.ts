import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../adapters/memory/db.js";
import { hashPassword, verificarPassword } from "../../adapters/crypto/password.js";
import {
  crearConfirmacionOperacionesStore,
  type ConfirmacionOperacionesStore,
} from "../../adapters/web/confirmacion-operaciones-store.js";
import { crearConversacionEmpleadoStore } from "../../adapters/web/conversacion-empleado-store.js";
import { upsertRolEmpleado } from "../../adapters/memory/repository.js";
import { buildOnComandoEmpleado, createSolicitudStore } from "../../build-on-comando-empleado.js";
import { buildOnOperacionesEmpleado } from "../../build-on-operaciones-empleado.js";
import { altaCredencialEmpleado } from "../../empleados.js";
import type { SoporteResult } from "../../build-on-soporte.js";
import type { SubmitPromptHandler, TuiTurnResult } from "../../adapters/tui/tui-port.js";
import type { AuthConfig } from "../../core/auth/auth-config.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado } from "../../core/auth/rol-contract.js";
import { CONVERSATIONAL_AGENT_ID } from "../../core/agents/definitions.js";
import { COMANDO_APROBAR_SOLICITUD, RESULTADO_NO_AUTORIZADO } from "../../core/commands/registro-acciones-contract.js";
import { createHookEngine } from "../../core/hooks/hook-engine.js";
import type { LogTurnEventDeps } from "../../core/logging/turn-logger.js";
import {
  DOMINIO_SOLICITUD,
  OPERACIONES_MCP_SERVER_NAME,
  OPERACIONES_TOOL_NAME,
} from "../../core/operaciones/operaciones-contract.js";
import { CASO_ESTADO_PENDIENTE_APROBACION_HUMANA } from "../../core/hitl/hitl-contract.js";
import { SOLICITUD_TIPO_GASTO } from "../../core/solicitudes/solicitudes-contract.js";
import type { MemoryPort } from "../../core/turn-selector/handle-turn.js";
import type { VentaNotifierPort } from "../../core/ventas/ventas-contract.js";
import type { VentasConfig } from "../../core/ventas/ventas-config.js";
import type { DespacharDelegacionDeps } from "../../core/turn-selector/dispatch-delegation.js";
import { KNOWLEDGE_MCP_SERVER_NAME } from "../../core/knowledge/knowledge-contract.js";
import type { KnowledgeAdapter } from "../../adapters/knowledge/index.js";

/**
 * `operaciones-negocio-tui`, tareas 5.1 y 5.2 (ADR 297-299, RD-170/171) —
 * verificacion de COMPOSICION contra piezas reales.
 *
 * NACE VERDE, y se declara asi: no dirige comportamiento. Confirma, con el
 * handler de operaciones REAL, el dispatcher de la TUI REAL, ambos stores
 * REALES y SQLite REAL (`:memory:`, migraciones reales), lo que los unitarios
 * de las tareas 1.x-2.x ya dirigieron. Sus dientes se prueban por mutacion en
 * 6.1 (M1: quitar `sesionVigente` de la guarda) y 6.2 (M2: quitar L2 de
 * `/logout`).
 *
 * Reales: `db`, `credenciales` (hash `scrypt`), `rolPort`, `registro`,
 * `buildOnOperacionesEmpleado`, `buildOnComandoEmpleado`,
 * `crearConfirmacionOperacionesStore()` y `crearConversacionEmpleadoStore()`.
 * Dobles: `handleTurn` (no hay LLM: en su lugar invoca la tool MCP REAL
 * registrada, con la operacion que dicta cada test), `onSubmit`, `onSoporte`,
 * `createKnowledge`, `notifier` y `despacharDeps`, que este flujo no toca.
 *
 * El texto libre NO decide la operacion (no hay modelo): la operacion de cada
 * turno la fija el test, y lo que se verifica es el ruteo, la identidad, la
 * confirmacion en dos turnos y la limpieza de estado.
 */
vi.mock("../../core/turn-selector/handle-turn.js", () => ({
  handleTurn: vi.fn(),
}));

import { handleTurn } from "../../core/turn-selector/handle-turn.js";

const mockedHandleTurn = vi.mocked(handleTurn);

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const PASSWORD_ANA = "password-de-ana-123";
const SOLICITUD_ID = "sol-1";
const DETALLE_SOLICITUD = "taxi al cliente";

/** Operacion que la tool recibe en cada turno: campos EXACTOS de `resolver_solicitud` (`validar-operacion.ts`). */
const OPERACION_APROBAR = { operacion: "resolver_solicitud", accion: "aprobar", solicitudId: SOLICITUD_ID } as const;

type HandlerDeTool = (args: unknown, extra: unknown) => Promise<{ readonly content: readonly [{ readonly text: string }] }>;

function herramientaRegistrada(server: unknown): HandlerDeTool {
  const tipado = server as unknown as {
    readonly instance: { readonly _registeredTools: Record<string, { readonly handler: HandlerDeTool }> };
  };
  const herramienta = tipado.instance._registeredTools[OPERACIONES_TOOL_NAME];
  if (herramienta === undefined) {
    throw new Error(`test setup error: tool "${OPERACIONES_TOOL_NAME}" was not registered`);
  }
  return herramienta.handler;
}

function fakeMemory(): MemoryPort {
  return {
    getCasoById: vi.fn(),
    getLatestSesionAgente: vi.fn(),
    updateCaso: vi.fn(),
    createSesionAgente: vi.fn(),
  };
}

function fakeKnowledge(): KnowledgeAdapter {
  return {
    mcpServers: { [KNOWLEDGE_MCP_SERVER_NAME]: {} as never },
    feedback: { saveTurnResult: vi.fn(), discardPendingCitations: vi.fn() },
  };
}

function fakeVentasConfig(): VentasConfig {
  return { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5_000 };
}

function fakeNotifier(): VentaNotifierPort {
  return { notificarLinkConfirmacion: vi.fn().mockResolvedValue({ enviado: true }) };
}

function fakeDespacharDeps(): DespacharDelegacionDeps {
  return {
    store: { crearDelegacion: vi.fn(), completarDelegacion: vi.fn() },
    invocar: vi.fn(),
    getSubagente: vi.fn(),
    newId: () => "delegacion-no-usada",
    now: () => TIMESTAMP,
    logEvent: vi.fn(),
  };
}

/** `logDeps` en memoria: ni `harness.log` ni la consola reciben nada del flujo. */
function fakeLogDeps(): LogTurnEventDeps {
  return { now: () => TIMESTAMP, write: () => undefined };
}

function volcado(db: Database.Database, tabla: string): string {
  return JSON.stringify(db.prepare(`SELECT * FROM "${tabla}" ORDER BY rowid`).all());
}

function estadoDeSolicitud(db: Database.Database): string | undefined {
  return (db.prepare("SELECT estado FROM solicitudes_internas WHERE id = ?").get(SOLICITUD_ID) as { estado: string } | undefined)
    ?.estado;
}

function filasDeAuditoria(db: Database.Database): { comando: string; resultado: string; empleado_id: string }[] {
  return db
    .prepare("SELECT comando, resultado, empleado_id FROM registro_acciones_empleado WHERE comando = ?")
    .all(COMANDO_APROBAR_SOLICITUD) as { comando: string; resultado: string; empleado_id: string }[];
}

interface Flujo {
  readonly db: Database.Database;
  readonly handler: SubmitPromptHandler;
  readonly onSubmit: ReturnType<typeof vi.fn>;
  /** Operacion que `handleTurn` (doble) manda a la tool en el proximo turno de operaciones. */
  operacionDelTurno: Record<string, unknown>;
}

/** Variaciones del arnes (remediacion W2b/W3a); sin opciones, el flujo es el de las tareas 5.1 y 5.2. */
interface OpcionesFlujo {
  /** Empleado sembrado con credencial y rol; por defecto `ana`. Su password es siempre `PASSWORD_ANA`. */
  readonly empleadoId?: string;
  /** Rol sembrado para ese empleado; por defecto `administrador`. */
  readonly rol?: RolEmpleado;
  /** Store de confirmacion que se inyecta a la TUI; por defecto, uno propio y nuevo. */
  readonly confirmacionStoreTui?: ConfirmacionOperacionesStore;
}

/**
 * Arma el flujo completo con la base sembrada: un empleado con credencial y rol
 * (por defecto la administradora `ana`), una solicitud interna pendiente de
 * otro solicitante (`juan`, para no chocar con la prohibicion de
 * autoaprobacion) y las piezas reales.
 */
function armarFlujo(opciones: OpcionesFlujo = {}): Flujo {
  const { empleadoId = "ana", rol = ROL_ADMINISTRADOR, confirmacionStoreTui = crearConfirmacionOperacionesStore() } = opciones;
  const db = openDatabase(":memory:");
  const alta = altaCredencialEmpleado(db, { empleadoId, password: PASSWORD_ANA, ahora: TIMESTAMP });
  expect(alta.ok).toBe(true);
  upsertRolEmpleado(db, { empleadoId, rol, ahora: TIMESTAMP });
  createSolicitudStore(db).crearSolicitudConCaso({
    caso: { id: "caso-sol-1", tipo: "solicitud", estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA },
    solicitud: {
      id: SOLICITUD_ID,
      solicitanteId: "juan",
      tipo: SOLICITUD_TIPO_GASTO,
      detalle: DETALLE_SOLICITUD,
      estado: CASO_ESTADO_PENDIENTE_APROBACION_HUMANA,
    },
    timestamp: TIMESTAMP,
  });

  const logDeps = fakeLogDeps();
  const onOperaciones = buildOnOperacionesEmpleado({
    db,
    memory: fakeMemory(),
    hooks: createHookEngine(),
    createKnowledge: () => fakeKnowledge(),
    ventasConfig: fakeVentasConfig(),
    notifier: fakeNotifier(),
    baseUrlPublica: "https://arnes.example.test",
    despacharDeps: fakeDespacharDeps(),
    logDeps,
  });

  const onSubmit = vi.fn(
    async (): Promise<TuiTurnResult> => ({ responseText: "camino-onSubmit", agentLabel: "sin-tool" }),
  );
  const handler = buildOnComandoEmpleado({
    onSubmit: onSubmit as unknown as SubmitPromptHandler,
    onSoporte: vi.fn(async (): Promise<SoporteResult> => ({ casoId: "caso-soporte", respuesta: "soporte" })),
    db,
    ventasConfig: fakeVentasConfig(),
    authConfig: { sesionTtlMinutos: 0, sesionInactividadMinutos: 0 } satisfies AuthConfig,
    verificarPassword,
    dummyPasswordHash: hashPassword("dummy-password-para-timing"),
    hooks: createHookEngine(),
    now: () => TIMESTAMP,
    logDeps,
    operacionesTui: {
      onOperaciones,
      confirmacionStore: confirmacionStoreTui,
      conversacionStore: crearConversacionEmpleadoStore(),
    },
  });

  const flujo: Flujo = { db, handler, onSubmit, operacionDelTurno: { ...OPERACION_APROBAR } };

  // Sin LLM: el turno "decide" la operacion que dicta el test y la ejecuta
  // por la tool MCP REAL que `buildOnOperacionesEmpleado` registro para ese turno.
  mockedHandleTurn.mockImplementation(async (_casoId, _prompt, deps) => {
    const invocar = herramientaRegistrada(deps.mcpServers?.[OPERACIONES_MCP_SERVER_NAME]);
    const resultado = await invocar(flujo.operacionDelTurno, {});
    return { responseText: resultado.content[0].text, agentLabel: CONVERSATIONAL_AGENT_ID };
  });

  return flujo;
}

async function loginAna(flujo: Flujo): Promise<void> {
  const resultado = await flujo.handler(`/login ana ${PASSWORD_ANA}`);
  expect(resultado.responseText).toContain("Sesión abierta como ana");
}

async function loginComo(flujo: Flujo, empleadoId: string): Promise<void> {
  const resultado = await flujo.handler(`/login ${empleadoId} ${PASSWORD_ANA}`);
  expect(resultado.responseText).toContain(`Sesión abierta como ${empleadoId}`);
}

beforeEach(() => {
  mockedHandleTurn.mockReset();
});

describe("operaciones-negocio-tui — flujo de composicion con stores y base reales (tareas 5.1 y 5.2; nacen verdes por criterio declarado)", () => {
  it("it 1 — sin login, el texto libre va a onSubmit y la tool de operaciones NO se invoca", async () => {
    const flujo = armarFlujo();
    try {
      const texto = "listá las solicitudes para aprobar";

      const resultado = await flujo.handler(texto);

      expect(flujo.onSubmit).toHaveBeenCalledTimes(1);
      expect(flujo.onSubmit.mock.calls[0]?.[0]).toBe(texto);
      expect(resultado).toEqual({ responseText: "camino-onSubmit", agentLabel: "sin-tool" });
      expect(mockedHandleTurn).not.toHaveBeenCalled();
      expect(estadoDeSolicitud(flujo.db)).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
    } finally {
      flujo.db.close();
    }
  });

  it("it 2 — /login, texto 1 pide confirmar sin tocar la BD y texto 2 ejecuta: solicitud resuelta con fila de auditoria", async () => {
    const flujo = armarFlujo();
    try {
      await loginAna(flujo);
      const solicitudesAntes = volcado(flujo.db, "solicitudes_internas");

      const turno1 = await flujo.handler("aprobá la solicitud sol-1");

      // Texto 1: llega a la tool (no a `onSubmit`), pide confirmar y la BD no cambia.
      expect(flujo.onSubmit).not.toHaveBeenCalled();
      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
      expect(mockedHandleTurn.mock.calls[0]?.[1]).toContain("aprobá la solicitud sol-1");
      expect(turno1.agentLabel).toBe(CONVERSATIONAL_AGENT_ID);
      expect(turno1.responseText).toContain(`Vas a aprobar la solicitud ${SOLICITUD_ID} (${DETALLE_SOLICITUD})`);
      expect(volcado(flujo.db, "solicitudes_internas")).toBe(solicitudesAntes);
      expect(estadoDeSolicitud(flujo.db)).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
      expect(filasDeAuditoria(flujo.db)).toEqual([]);

      const turno2 = await flujo.handler("sí, confirmo");

      // Texto 2: la confirmacion del store REAL de la TUI habilita la ejecucion.
      expect(flujo.onSubmit).not.toHaveBeenCalled();
      expect(mockedHandleTurn).toHaveBeenCalledTimes(2);
      expect(turno2.responseText).toBe(`Listo: la solicitud ${SOLICITUD_ID} quedó aprobada.`);
      expect(estadoDeSolicitud(flujo.db)).toBe("aprobada");
      const auditoria = filasDeAuditoria(flujo.db);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]?.empleado_id).toBe("ana");
    } finally {
      flujo.db.close();
    }
  });

  it("it 3 — tras /logout el texto libre vuelve a onSubmit y la tool NO se invoca (invariante 3)", async () => {
    const flujo = armarFlujo();
    try {
      await loginAna(flujo);
      await flujo.handler("aprobá la solicitud sol-1");
      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);

      const cierre = await flujo.handler("/logout");
      expect(cierre.responseText).toBe("Sesión cerrada.");

      const texto3 = "y ahora confirmo";
      const resultado = await flujo.handler(texto3);

      expect(flujo.onSubmit).toHaveBeenCalledTimes(1);
      expect(flujo.onSubmit.mock.calls[0]?.[0]).toBe(texto3);
      expect(resultado).toEqual({ responseText: "camino-onSubmit", agentLabel: "sin-tool" });
      // La unica invocacion de la tool sigue siendo la de antes del /logout.
      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
      expect(estadoDeSolicitud(flujo.db)).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
    } finally {
      flujo.db.close();
    }
  });

  it("it 4 — una confirmacion marcada antes del /logout NO confirma tras un nuevo /login (R8, L2/L3); una nueva si", async () => {
    const flujo = armarFlujo();
    try {
      await loginAna(flujo);
      const marcada = await flujo.handler("aprobá la solicitud sol-1");
      expect(marcada.responseText).toContain(`Vas a aprobar la solicitud ${SOLICITUD_ID}`);

      await flujo.handler("/logout");
      await loginAna(flujo);

      // Mismo empleado, misma operacion: la ranura vieja ya no existe, asi que pide confirmar de nuevo.
      const tras = await flujo.handler("aprobá la solicitud sol-1");

      expect(tras.responseText).toContain(`Vas a aprobar la solicitud ${SOLICITUD_ID}`);
      expect(tras.responseText).not.toContain("Listo");
      expect(estadoDeSolicitud(flujo.db)).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
      expect(filasDeAuditoria(flujo.db)).toEqual([]);

      // Triangulacion: la confirmacion NUEVA (marcada en la sesion actual) si ejecuta.
      const confirmada = await flujo.handler("sí, confirmo");

      expect(confirmada.responseText).toBe(`Listo: la solicitud ${SOLICITUD_ID} quedó aprobada.`);
      expect(estadoDeSolicitud(flujo.db)).toBe("aprobada");
      expect(filasDeAuditoria(flujo.db)).toHaveLength(1);
      expect(flujo.onSubmit).not.toHaveBeenCalled();
    } finally {
      flujo.db.close();
    }
  });

  /**
   * Remediacion W2b (Reviewer): la TUI NO agrega un gate de rol propio (invariante
   * 8, ADR 297) — el gate vive DENTRO de la operacion (`resolverSolicitudInterna`,
   * `puedeResolverAjeno`). Hay que ver que un empleado sin el rol requerido, que
   * llega por el dispatcher de la TUI con sesion vigente y confirma en dos turnos,
   * es rechazado ahi adentro. Comportamiento real (ejecutar-operacion.ts): el
   * turno 1 NO consulta el rol (pide confirmar igual); el rechazo ocurre en el
   * turno 2, tras `consumir`, y deja UNA fila de auditoria `no_autorizado`.
   */
  it("it 5 — un empleado sin rol administrador confirma en dos turnos desde la TUI y la operacion lo rechaza por dentro: la BD no cambia y queda una fila de auditoria no_autorizado", async () => {
    const flujo = armarFlujo({ empleadoId: "beto", rol: ROL_EMPLEADO });
    try {
      await loginComo(flujo, "beto");
      const solicitudesAntes = volcado(flujo.db, "solicitudes_internas");

      const turno1 = await flujo.handler("aprobá la solicitud sol-1");

      // Turno 1: la TUI lo rutea a la tool y la operacion pide confirmar (sin mirar el rol todavia).
      expect(flujo.onSubmit).not.toHaveBeenCalled();
      expect(mockedHandleTurn).toHaveBeenCalledTimes(1);
      expect(turno1.responseText).toContain(`Vas a aprobar la solicitud ${SOLICITUD_ID} (${DETALLE_SOLICITUD})`);
      expect(filasDeAuditoria(flujo.db)).toEqual([]);

      const turno2 = await flujo.handler("sí, confirmo");

      // Turno 2: la confirmacion es valida, pero el gate de rol de la operacion la rechaza.
      expect(flujo.onSubmit).not.toHaveBeenCalled();
      expect(mockedHandleTurn).toHaveBeenCalledTimes(2);
      expect(turno2.responseText).toBe("No estás autorizado para aprobar esa solicitud: se requiere rol elevado.");
      expect(turno2.responseText).not.toContain("Listo");
      expect(volcado(flujo.db, "solicitudes_internas")).toBe(solicitudesAntes);
      expect(estadoDeSolicitud(flujo.db)).toBe(CASO_ESTADO_PENDIENTE_APROBACION_HUMANA);
      expect(filasDeAuditoria(flujo.db)).toEqual([
        { comando: COMANDO_APROBAR_SOLICITUD, resultado: RESULTADO_NO_AUTORIZADO, empleado_id: "beto" },
      ]);
    } finally {
      flujo.db.close();
    }
  });
});
