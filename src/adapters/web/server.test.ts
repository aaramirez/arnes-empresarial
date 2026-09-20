import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../memory/db.js";
import { buildOnVenta, createDelegacionA2AStore, createVentaStore } from "../../build-on-venta.js";
import { createCaso, insertAccionEmpleado, upsertRolEmpleado } from "../memory/repository.js";
import { ejecutarOperacion, type EjecutarOperacionDeps, type EjecutarOperacionInput } from "../../core/operaciones/ejecutar-operacion.js";
import type { DelegacionA2AStorePort } from "../../core/turn-selector/dispatch-delegation-a2a.js";
import {
  OPERACION_CONSULTAR_KPI,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_RESOLVER_REEMBOLSO,
} from "../../core/operaciones/operaciones-contract.js";
import { CONSULTAS_KPI } from "../../core/agents/consultas-kpi-catalogo.js";
import type { ClienteA2APort, ResultadoA2A } from "../../core/agents/a2a-contract.js";
import { ROL_ADMINISTRADOR, type RolEmpleado, type RolEmpleadoPort } from "../../core/auth/rol-contract.js";
import type { SolicitudStorePort } from "../../core/solicitudes/solicitudes-contract.js";
import type { ReporteStorePort } from "../../core/ventas/reporte-contract.js";
import type { ConsultaVentaPropiaPort } from "../../core/ventas/consulta-venta-contract.js";
import type { ConsultaSolicitudPropiaPort } from "../../core/solicitudes/consulta-solicitud-propia-contract.js";
import type { SolicitudA2AEntranteStorePort } from "../../core/agents/a2a-entrante-contract.js";
import type { JustificacionDevolucionPort } from "../../core/ventas/justificacion-devolucion-contract.js";
import type { DelegacionStorePort, DespacharDelegacionDeps } from "../../core/turn-selector/dispatch-delegation.js";
import { getSubagentDefinition } from "../../core/agents/definitions.js";
import type { RegistroAccionesEmpleadoPort } from "../../core/commands/registro-acciones-contract.js";
import type { VentasConfig } from "../../core/ventas/ventas-config.js";
import {
  CSP_CHAT,
  OPERACIONES_TIMEOUT_MS,
  RUTA_CHAT,
  RUTA_CHAT_ESTILOS,
  RUTA_CHAT_SCRIPT,
  RUTA_CONFIRMAR_PREFIJO,
  RUTA_DEVOLUCION,
  RUTA_LOGIN,
  RUTA_OPERACIONES,
  RUTA_SOPORTE,
  RUTA_VENTAS,
  SOPORTE_TIMEOUT_MS,
  WEB_CLOSE_TIMEOUT_MS,
  WEB_LOG_CORRELATION_ID,
  type WebConfig,
} from "./config.js";
import { CHAT_CLIENT_JS } from "./chat-client.js";
import { CHAT_CSS, renderChatHtml } from "./chat-page.js";
import type { CreateWebServerFn, WebRequest, WebResponse } from "./http.js";
import {
  createRequestListener,
  startServer,
  type LoginHttpResult,
  type SoporteResult,
  type WebServerDeps,
} from "./server.js";
import type { RegistrarVentaResult } from "../../core/ventas/registrar-venta.js";
import {
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  type NotificacionResultado,
  type VentaNotifierPort,
  type VentaPublica,
} from "../../core/ventas/ventas-contract.js";
import type { SesionEmpleado } from "../../core/auth/sesion.js";
import type { ConfirmacionOperacionPort, LlaveConfirmacion } from "../../core/operaciones/operaciones-contract.js";
import {
  DOMINIO_REEMBOLSO,
  DOMINIO_SOLICITUD,
  OPERACIONES_TOOL_QUALIFIED_NAME,
} from "../../core/operaciones/operaciones-contract.js";
import { crearSesionEmpleadoStore, type SesionEmpleadoStore } from "./sesion-empleado-store.js";
import { crearConfirmacionOperacionesStore, type ConfirmacionOperacionesStore } from "./confirmacion-operaciones-store.js";
import type { ConversacionEmpleadoStore } from "./conversacion-empleado-store.js";
import type { ConversacionEmpleadoPort } from "../../core/conversacion/conversacion-contract.js";
import { CONVERSATIONAL_AGENT_ID, getAgentDefinition } from "../../core/agents/definitions.js";

const CONFIG: WebConfig = {
  port: 8080,
  publicUrl: "http://localhost:8080",
  ventasApiToken: "secreto-de-prueba",
  maxBodyBytes: 1024,
};

const REQUEST_ID = "req-1";

/** Doble plano de `http.IncomingMessage` que satisface `WebRequest` estructuralmente. */
class FakeRequest implements WebRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  destroy = vi.fn();
  resume = vi.fn();

  private listeners: {
    data: Array<(chunk: Buffer) => void>;
    end: Array<() => void>;
    error: Array<(error: Error) => void>;
  } = { data: [], end: [], error: [] };

  constructor(init: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
  }) {
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers ?? {};
  }

  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "data" | "end" | "error", listener: (...args: never[]) => unknown): unknown {
    if (event === "data") {
      this.listeners.data.push(listener as (chunk: Buffer) => void);
    } else if (event === "end") {
      this.listeners.end.push(listener as () => void);
    } else {
      this.listeners.error.push(listener as (error: Error) => void);
    }
    return this;
  }

  /** Simula la llegada de chunks y el cierre normal del body. */
  emitBody(chunks: Buffer[]): void {
    for (const chunk of chunks) {
      for (const listener of this.listeners.data) {
        listener(chunk);
      }
    }
    for (const listener of this.listeners.end) {
      listener();
    }
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.error) {
      listener(error);
    }
  }
}

/** Doble plano de `http.ServerResponse` que satisface `WebResponse` estructuralmente. */
class FakeResponse implements WebResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  end = vi.fn();

  setHeader(name: string, value: string): unknown {
    this.headers.set(name, value);
    return this;
  }
}

/**
 * Doble ESTRICTO de `http.ServerResponse` -- a diferencia de `FakeResponse`
 * de arriba, éste sí reproduce la semántica real de Node: `setHeader` tras
 * `end()` lanza (mismo error que `ERR_HTTP_HEADERS_SENT`). Hallazgo del
 * Reviewer sobre `respondHtmlChat` (chat-web-empleado): `FakeResponse` no
 * detectaba el orden incorrecto porque no distinguía "ya terminé de
 * responder" de "todavía puedo setear headers". Se usa en las rutas de chat
 * para que este bug no pueda reaparecer sin que un test lo agarre.
 */
class StrictFakeResponse implements WebResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  private ended = false;
  end = vi.fn((..._args: unknown[]) => {
    this.ended = true;
  });

  setHeader(name: string, value: string): unknown {
    if (this.ended) {
      throw new Error(`ERR_HTTP_HEADERS_SENT: no se puede setear '${name}' después de end()`);
    }
    this.headers.set(name, value);
    return this;
  }
}

/**
 * Espera a que la respuesta se haya completado. NO se usa `res.statusCode`
 * como condición de espera: `FakeResponse.statusCode` arranca en `200`
 * (mismo default que `http.ServerResponse`), así que esperar
 * `statusCode === 200` o `statusCode > 0` sería una condición trivialmente
 * verdadera desde el arranque y el test avanzaría ANTES de que el handler
 * async terminara. `res.end` haber sido invocado es la única señal
 * confiable de que la respuesta terminó.
 */
async function esperarRespuesta(res: FakeResponse): Promise<void> {
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
}

function fakeConfirmacion(): ConfirmacionOperacionPort {
  return {
    estaConfirmada: vi.fn().mockReturnValue(false),
    marcarPendiente: vi.fn(),
    consumir: vi.fn(),
  };
}

function fakeSesionStore(overrides: Partial<SesionEmpleadoStore> = {}): SesionEmpleadoStore {
  return {
    crear: vi.fn().mockReturnValue("token-nuevo"),
    buscar: vi.fn().mockReturnValue(undefined),
    eliminar: vi.fn(),
    otraSesionVigente: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function fakeConfirmacionOperacionesStore(
  overrides: Partial<ConfirmacionOperacionesStore> = {},
): ConfirmacionOperacionesStore {
  return {
    paraEmpleado: vi.fn().mockReturnValue(fakeConfirmacion()),
    limpiarEmpleado: vi.fn(),
    ...overrides,
  };
}

/** chat-web-empleado, tarea 4 — doble plano de `ConversacionEmpleadoPort` (ADR 196). */
function fakeConversacion(overrides: Partial<ConversacionEmpleadoPort> = {}): ConversacionEmpleadoPort {
  return {
    casoAnterior: vi.fn().mockReturnValue(undefined),
    registrarTurno: vi.fn(),
    conversacionId: vi.fn().mockReturnValue("conv-1"),
    ...overrides,
  };
}

/** chat-web-empleado, tarea 4 — doble plano de `ConversacionEmpleadoStore` (ADR 196 §2). */
function fakeConversacionStore(overrides: Partial<ConversacionEmpleadoStore> = {}): ConversacionEmpleadoStore {
  return {
    paraSesion: vi.fn().mockReturnValue(fakeConversacion()),
    eliminar: vi.fn(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WebServerDeps> = {}): WebServerDeps {
  return {
    config: CONFIG,
    onAltaVenta: vi.fn(),
    onConsultaVenta: vi.fn(),
    onDecisionVenta: vi.fn(),
    onDevolucion: vi.fn(),
    onSoporte: vi.fn(),
    onLogin: vi.fn(),
    onOperacionesEmpleado: vi.fn(),
    sesionStore: fakeSesionStore(),
    confirmacionOperacionesStore: fakeConfirmacionOperacionesStore(),
    conversacionStore: fakeConversacionStore(),
    logEvent: vi.fn(),
    newRequestId: () => REQUEST_ID,
    ...overrides,
  };
}

function jsonBody(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

const VENTA_PAYLOAD_VALIDO = {
  vendedorId: "vend-1",
  vendedorNombre: "Ana",
  clienteId: "cli-1",
  clienteEmail: "cliente@example.com",
  planNuevo: "pro",
  monto: 1000,
};

const REGISTRAR_VENTA_RESULT: RegistrarVentaResult = {
  ventaId: "venta-1",
  casoId: "caso-1",
  linkConfirmacion: "http://localhost:8080/confirmar/token-1",
  notificado: true,
};

const VENTA_PUBLICA: VentaPublica = {
  planNuevo: "pro",
  monto: 1000,
};

const SOPORTE_RESULT: SoporteResult = {
  casoId: "caso-soporte-1",
  respuesta: "respuesta del bot",
};

const OPERACIONES_RESULT: SoporteResult = {
  casoId: "caso-operaciones-1",
  respuesta: "operación registrada",
};

const SESION_EMPLEADO: SesionEmpleado = {
  empleadoId: "emp-1",
  iniciadaEn: "2026-01-01T00:00:00.000Z",
};

function authHeader(token = CONFIG.ventasApiToken): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Doble plano de `http.Server` compartido por todas las suites de
 * drenaje de `close()` (`/soporte` y `/operaciones`) -- extraído a
 * ámbito de módulo (antes vivía solo dentro de la suite de `/soporte`)
 * para que la suite nueva de `/operaciones` y la combinada lo reusen sin
 * duplicar el doble.
 */
function makeFakeHttpServer(): {
  server: { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  createServer: CreateWebServerFn;
  getListener: () => (req: WebRequest, res: WebResponse) => void;
} {
  let capturedListener: ((req: WebRequest, res: WebResponse) => void) | undefined;
  const server = {
    listen: vi.fn((_port: number, callback: () => void) => {
      callback();
    }),
    close: vi.fn((callback: (error?: Error) => void) => {
      callback();
    }),
    on: vi.fn(),
  };
  const createServer = vi.fn((listener: (req: WebRequest, res: WebResponse) => void) => {
    capturedListener = listener;
    return server;
  });
  return {
    server,
    createServer,
    getListener: () => {
      if (capturedListener === undefined) {
        throw new Error("listener not captured yet");
      }
      return capturedListener;
    },
  };
}

describe("createRequestListener — ruteo", () => {
  it("responds 404 (empty body) for an unrecognized path", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: "/no-existe", headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it("responds 404 (empty body) for a recognized path with the wrong method (GET /ventas)", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: RUTA_VENTAS, headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
    expect(deps.onAltaVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /ventas", () => {
  it("responds 401 without calling the handler when VENTAS_API_TOKEN is empty ('' never open by default)", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta, config: { ...CONFIG, ventasApiToken: "" } });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_VENTAS,
      headers: authHeader("cualquier-cosa"),
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-no-autorizado", expect.anything());
  });

  it("responds 401 without calling the handler when the Authorization header is missing", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
  });

  it("responds 401 (not a thrown RangeError) when the header has a different length than expected", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_VENTAS,
      headers: authHeader("corto"),
    });
    const res = new FakeResponse();

    expect(() => {
      listener(req, res);
      req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    }).not.toThrow();

    await esperarRespuesta(res);
    expect(res.statusCode).toBe(401);
    expect(onAltaVenta).not.toHaveBeenCalled();
  });

  it("responds 413, destroys the request, and never calls the handler when the body exceeds maxBodyBytes", async () => {
    const onAltaVenta = vi.fn();
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    const bigChunk = Buffer.alloc(CONFIG.maxBodyBytes + 1, "a");
    req.emitBody([bigChunk]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(onAltaVenta).not.toHaveBeenCalled();
    expect(deps.logEvent).toHaveBeenCalledWith(
      REQUEST_ID,
      "web-rechazado-tamano",
      expect.objectContaining({ ruta: RUTA_VENTAS }),
    );
  });

  it("responds 400 with a broken JSON body", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.from("no-es-json{{{", "utf8")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-payload-invalido", expect.anything());
  });

  it("responds 400 with an invalid payload (missing required field)", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ ...VENTA_PAYLOAD_VALIDO, monto: undefined })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
  });

  it("responds 201 with the created sale on a valid payload, and calls the handler with the parsed input", async () => {
    const onAltaVenta = vi.fn().mockResolvedValue(REGISTRAR_VENTA_RESULT);
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(201);
    expect(onAltaVenta).toHaveBeenCalledWith(VENTA_PAYLOAD_VALIDO);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(REGISTRAR_VENTA_RESULT));
  });

  it("responds 500 with a generic error and logs web-handler-fallido when the handler throws", async () => {
    const onAltaVenta = vi.fn().mockRejectedValue(new Error("store rompió"));
    const deps = makeDeps({ onAltaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody(VENTA_PAYLOAD_VALIDO)]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(500);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "web-handler-fallido", expect.anything());
    const body = JSON.parse(res.end.mock.calls[0]![0] as string) as { error: string };
    expect(body.error).not.toContain("store rompió");
  });
});

/**
 * `aprobacion-conversacional-hitl`, tarea 13 (ADR 211 pto 5, Success
 * Criteria de `proposal.md`) — R7 verificada en los DOS SENTIDOS por el
 * canal conversacional, contra código de producción REAL: `db` SQLite real
 * (`:memory:`), `store` de ventas real (`createVentaStore(db)`), `onAltaVenta`
 * real (`buildOnVenta(...).onAltaVenta`, la MISMA pieza que compone
 * `main.ts` para `POST /ventas`). La resolución del reembolso se ejercita
 * directamente contra `ejecutarOperacion` (el dispatcher real de la tarea
 * 13) — no contra el turno conversacional completo (que exige invocar el
 * modelo, fuera de alcance: CERO llamadas al modelo en las piezas
 * deterministas, mismo criterio que el resto de `src/core/`).
 */
function realNotifierR7(): VentaNotifierPort {
  return {
    notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => ({ enviado: true })),
  };
}

function unusedSolicitudStoreR7(): SolicitudStorePort {
  const unused = (): never => {
    throw new Error("SolicitudStorePort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return {
    crearSolicitudConCaso: unused,
    adjuntarDictamen: unused,
    listarSolicitudesPendientes: unused,
    aprobarSolicitud: unused,
    rechazarSolicitud: unused,
    cancelarSolicitud: unused,
  };
}

function unusedReporteStoreR7(): ReporteStorePort {
  const unused = (): never => {
    throw new Error("ReporteStorePort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return { listComisionesPorPeriodo: unused, listVentasEnReembolsoPendiente: unused };
}

/** `devolucion-sin-token-dos-personas`, tarea 7 — mismo molde que `unusedReporteStoreR7`. */
function unusedConsultaVentaPropiaR7(): ConsultaVentaPropiaPort {
  const unused = (): never => {
    throw new Error("ConsultaVentaPropiaPort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return { buscarPorId: unused, listarDeVendedor: unused };
}

/** `consulta-solicitud-propia`, tarea 5.2 — mismo molde que `unusedConsultaVentaPropiaR7`. */
function unusedConsultaSolicitudPropiaR7(): ConsultaSolicitudPropiaPort {
  const unused = (): never => {
    throw new Error("ConsultaSolicitudPropiaPort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return { buscarPorId: unused, listarDeSolicitante: unused };
}

/** `visibilidad-a2a-entrante-chat`, tarea 5.2 — mismo molde "unused" que `unusedConsultaSolicitudPropiaR7` (campo requerido de `EjecutarOperacionDeps` desde la tarea 4.2, no ejercitado por resolver_reembolso/registrar_venta). */
function unusedSolicitudA2AEntranteR7(): SolicitudA2AEntranteStorePort {
  const unused = (): never => {
    throw new Error("SolicitudA2AEntranteStorePort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return { listarPorEstados: unused, obtenerPorTaskId: unused };
}

/** `devolucion-sin-token-dos-personas`, tarea 16 — mismo criterio "unused" que `unusedConsultaVentaPropiaR7`. */
function unusedJustificacionR7(): JustificacionDevolucionPort {
  return {
    registrar: () => {
      throw new Error("JustificacionDevolucionPort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
    },
  };
}

/** `consulta-kpi-a2a-chat`, tarea 3.1 — mismo molde "unused": campo requerido de `EjecutarOperacionDeps`, no ejercitado por resolver_reembolso/registrar_venta. */
function unusedDelegacionA2AStoreR7(): DelegacionA2AStorePort {
  const unused = (): never => {
    throw new Error("DelegacionA2AStorePort no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  return { crearDelegacionA2A: unused, actualizarDelegacionA2A: unused };
}

function unusedDespacharDepsR7(): DespacharDelegacionDeps {
  const unused = (): never => {
    throw new Error("DespacharDelegacionDeps no debería invocarse — resolver_reembolso/registrar_venta no lo tocan");
  };
  const delegacionStore: DelegacionStorePort = { crearDelegacion: unused, completarDelegacion: unused };
  return {
    store: delegacionStore,
    invocar: unused,
    getSubagente: getSubagentDefinition,
    newId: () => "id-no-usado",
    now: () => "2026-01-01T00:00:00.000Z",
    logEvent: vi.fn(),
  };
}

const VENTAS_CONFIG_R7: VentasConfig = {
  comisionPorcentaje: 0.1,
  reembolsoUmbral: 500,
  tokenTtlHoras: 72,
  ventaGrandeUmbral: 5000,
};

function realRolPortR7(rol: RolEmpleado | undefined = ROL_ADMINISTRADOR): RolEmpleadoPort {
  return { buscarRol: () => rol };
}

function makeRegistroR7(): RegistroAccionesEmpleadoPort {
  return { registrarAccion: vi.fn() };
}

/** `EjecutarOperacionDeps` con `store` REAL (SQLite) — el resto son dobles inertes ("unused..."), sin uso en el camino de `resolver_reembolso`/`registrar_venta`. */
function ejecutarDepsR7(db: Database.Database, overrides: Partial<EjecutarOperacionDeps> = {}): EjecutarOperacionDeps {
  let contador = 0;
  return {
    store: createVentaStore(db),
    solicitudStore: unusedSolicitudStoreR7(),
    config: VENTAS_CONFIG_R7,
    notifier: realNotifierR7(),
    baseUrlPublica: "http://localhost:8080",
    reporteStore: unusedReporteStoreR7(),
    consultaVentaPropia: unusedConsultaVentaPropiaR7(),
    consultaSolicitudPropia: unusedConsultaSolicitudPropiaR7(),
    solicitudA2AEntrante: unusedSolicitudA2AEntranteR7(),
    justificacion: unusedJustificacionR7(),
    delegacionA2AStore: unusedDelegacionA2AStoreR7(),
    despacharDeps: unusedDespacharDepsR7(),
    rolPort: realRolPortR7(),
    registro: makeRegistroR7(),
    newId: () => `id-r7-${contador++}`,
    newToken: () => `token-r7-${contador++}`,
    now: () => "2026-01-01T00:00:00.000Z",
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("createRequestListener + ejecutarOperacion — R7 en los DOS sentidos por el canal conversacional (aprobacion-conversacional-hitl, tarea 13, ADR 211 pto 5)", () => {
  it("★ (i) registrar_venta por el canal conversacional (empleado E) ⇒ vendedorId = E; E con rol elevado ⇒ autoaprobacion_prohibida al resolver su propio reembolso, cero cambios en ventas", async () => {
    const db = openDatabase(":memory:");
    try {
      const deps = ejecutarDepsR7(db, { rolPort: realRolPortR7(ROL_ADMINISTRADOR) });
      const sesionE: SesionEmpleado = { empleadoId: "empleado-E", iniciadaEn: "2026-01-01T00:00:00.000Z" };
      const confirmacionEco: ConfirmacionOperacionPort = {
        estaConfirmada: vi.fn().mockReturnValue(false),
        marcarPendiente: vi.fn(),
        consumir: vi.fn(),
      };

      // 1. registrar_venta por el canal conversacional — vendedorId sale de sesion.empleadoId, NUNCA de un campo de la operación.
      const textoAlta = await ejecutarOperacion(
        {
          operacion: {
            operacion: OPERACION_REGISTRAR_VENTA,
            clienteId: "cliente-1",
            clienteEmail: "cliente@example.com",
            planNuevo: "premium",
            monto: 1000,
            vendedorNombre: "Empleado E",
          },
          sesion: sesionE,
          confirmacion: confirmacionEco,
          casoIdActual: "caso-turno-1",
        },
        deps,
      );
      expect(textoAlta).toContain("Venta registrada");

      // Se lee `ventaId`/`casoId` de la fila real recién creada (única venta
      // de `cliente-1` en este `:memory:` fresco) en vez de parsear el texto
      // del eco: el eco es texto libre para el empleado (`vendedorNombre`
      // puede contener cualquier caracter, ADR 221 pto 1), no un formato
      // contractual para extraer datos (hallazgo code-review, ergonomia-canal-empleado).
      const ventaFila = db
        .prepare("SELECT id AS ventaId, caso_id AS casoId, vendedor_id AS vendedorId FROM ventas WHERE cliente_id = ?")
        .get("cliente-1") as { ventaId: string; casoId: string; vendedorId: string } | undefined;
      if (ventaFila === undefined) {
        throw new Error("test setup error: no se encontró la venta recién creada para cliente-1");
      }
      const ventaId = ventaFila.ventaId;
      const casoId = ventaFila.casoId;
      expect(ventaFila.vendedorId).toBe("empleado-E");

      // 2. Escalar a reembolso_pendiente — vía el `VentaStorePort` (`deps.store`)
      //    que este propio test ya construye para `ejecutarOperacion`, NUNCA
      //    llamando a `../memory/repository.js` directo (hallazgo Reviewer,
      //    conventions: ningún adaptador se comunica con otro sin pasar por
      //    el núcleo — ni siquiera en tests).
      deps.store.confirmarVentaConComision({
        ventaId,
        comisionId: "comision-1",
        comisionMonto: 100,
        periodo: "2026-01",
        ahora: "2026-01-01T00:00:00.000Z",
      });
      deps.store.escalarReembolso({ ventaId, casoId, ahora: "2026-01-01T00:00:00.000Z" });

      // 3. E (rol elevado) intenta aprobar SU PROPIO reembolso, en dos turnos (eco + confirmación).
      await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId },
          sesion: sesionE,
          confirmacion: confirmacionEco,
          casoIdActual: "caso-turno-2",
        },
        deps,
      );
      const confirmacionConfirmada: ConfirmacionOperacionPort = {
        estaConfirmada: vi.fn().mockReturnValue(true),
        marcarPendiente: vi.fn(),
        consumir: vi.fn(),
      };
      const textoResolucion = await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId },
          sesion: sesionE,
          confirmacion: confirmacionConfirmada,
          casoIdActual: "caso-turno-3",
        },
        deps,
      );

      expect(textoResolucion).toBe("No podés aprobar el reembolso de tu propia venta, aunque tengas rol elevado.");

      const ventaTrasIntento = db.prepare("SELECT estado FROM ventas WHERE id = ?").get(ventaId) as { estado: string };
      expect(ventaTrasIntento.estado).toBe(VENTA_ESTADO_REEMBOLSO_PENDIENTE);
    } finally {
      db.close();
    }
  });

  it("★ (ii) test negativo obligatorio: venta dada de alta por POST /ventas (sin sesión de empleado, vendedorId del payload externo) ⇒ un administrador SÍ puede resolver su reembolso", async () => {
    const db = openDatabase(":memory:");
    try {
      const store = createVentaStore(db);
      const ventaHandlers = buildOnVenta({
        db,
        store,
        notifier: realNotifierR7(),
        ventasConfig: VENTAS_CONFIG_R7,
        baseUrlPublica: "http://localhost:8080",
      });
      const webDeps = makeDeps({ onAltaVenta: ventaHandlers.onAltaVenta });
      const listener = createRequestListener(webDeps);
      const req = new FakeRequest({ method: "POST", url: RUTA_VENTAS, headers: authHeader() });
      const res = new FakeResponse();

      // 1. Alta real vía POST /ventas — vendedorId viene del PAYLOAD externo, nunca de una sesión de empleado (que ni siquiera existe en esta ruta).
      listener(req, res);
      req.emitBody([
        jsonBody({
          vendedorId: "vend-externo",
          vendedorNombre: "Vendedor Externo",
          clienteId: "cliente-2",
          clienteEmail: "cliente2@example.com",
          planNuevo: "premium",
          monto: 1000,
        }),
      ]);
      await esperarRespuesta(res);
      expect(res.statusCode).toBe(201);
      const { ventaId, casoId } = JSON.parse(res.end.mock.calls[0]![0] as string) as {
        ventaId: string;
        casoId: string;
      };

      const ventaFila = db.prepare("SELECT vendedor_id AS vendedorId FROM ventas WHERE id = ?").get(ventaId) as {
        vendedorId: string;
      };
      expect(ventaFila.vendedorId).toBe("vend-externo");

      // 2. Escalar a reembolso_pendiente — vía el MISMO `store`
      //    (`VentaStorePort`) que este test ya construyó arriba para
      //    `buildOnVenta`, nunca vía `../memory/repository.js` directo
      //    (hallazgo Reviewer, conventions).
      store.confirmarVentaConComision({
        ventaId,
        comisionId: "comision-2",
        comisionMonto: 100,
        periodo: "2026-01",
        ahora: "2026-01-01T00:00:00.000Z",
      });
      store.escalarReembolso({ ventaId, casoId, ahora: "2026-01-01T00:00:00.000Z" });

      // 3. Un administrador (empleadoId distinto de "vend-externo", ni siquiera del mismo espacio de identidad) resuelve normalmente.
      const deps = ejecutarDepsR7(db);
      const sesionAdmin: SesionEmpleado = { empleadoId: "admin-1", iniciadaEn: "2026-01-01T00:00:00.000Z" };
      const confirmacionConfirmada: ConfirmacionOperacionPort = {
        estaConfirmada: vi.fn().mockReturnValue(true),
        marcarPendiente: vi.fn(),
        consumir: vi.fn(),
      };

      const textoResolucion = await ejecutarOperacion(
        {
          operacion: { operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId },
          sesion: sesionAdmin,
          confirmacion: confirmacionConfirmada,
          casoIdActual: "caso-turno-1",
        },
        deps,
      );

      expect(textoResolucion).not.toContain("No podés");
      expect(textoResolucion).toContain("quedó");

      const ventaTrasResolucion = db.prepare("SELECT estado FROM ventas WHERE id = ?").get(ventaId) as {
        estado: string;
      };
      expect(ventaTrasResolucion.estado).toBe(VENTA_ESTADO_REEMBOLSADA);
    } finally {
      db.close();
    }
  });
});

describe("createRequestListener — GET /confirmar/:token", () => {
  it("responds 200 with the confirmation form when the token resolves to a pending sale", async () => {
    const onConsultaVenta = vi.fn().mockResolvedValue(VENTA_PUBLICA);
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(onConsultaVenta).toHaveBeenCalledWith("token-1");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Request-Id")).toBe(REQUEST_ID);
  });

  it("responds 404 with the generic page when onConsultaVenta returns undefined", async () => {
    const onConsultaVenta = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}vencido`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
  });

  it.each([
    ["empty token", ""],
    ["token containing a slash", "abc/def"],
    ["token exceeding 200 characters", "a".repeat(201)],
  ])("responds 404 with the generic page for an invalid token (%s), without calling the handler", async (_label, token) => {
    const onConsultaVenta = vi.fn();
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}${token}`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onConsultaVenta).not.toHaveBeenCalled();
  });

  it("falls into the same generic page (no throw) when the token has an invalid % escape sequence", async () => {
    const onConsultaVenta = vi.fn();
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}%E0%A4%A`, headers: {} });
    const res = new FakeResponse();

    expect(() => listener(req, res)).not.toThrow();
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onConsultaVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /confirmar/:token", () => {
  function formBody(decision: string): Buffer {
    return Buffer.from(`decision=${decision}`, "utf8");
  }

  it("responds 200 'confirmada' when decision=confirmar and the CAS applied", async () => {
    const onDecisionVenta = vi
      .fn()
      .mockResolvedValue({ resultado: "confirmada", comisionMonto: 100, periodo: "2026-09" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("confirmar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(onDecisionVenta).toHaveBeenCalledWith({ token: "token-1", decision: "confirmar" });
    const body = res.end.mock.calls[0]![0] as string;
    expect(body).toContain("confirmada");
  });

  it("responds 200 'rechazada' when decision=rechazar and the CAS applied", async () => {
    const onDecisionVenta = vi.fn().mockResolvedValue({ resultado: "rechazada" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("rechazar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    const body = res.end.mock.calls[0]![0] as string;
    expect(body).toContain("rechazada");
  });

  it("responds 404 with the generic page for an invalid decision value, without calling the handler", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("lo-que-sea")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });

  it("responds 404 with the generic page when the CAS did not apply (resultado: no_aplicable)", async () => {
    const onDecisionVenta = vi.fn().mockResolvedValue({ resultado: "no_aplicable", motivo: "carrera" });
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([formBody("confirmar")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
  });

  it("responds 404 with the generic page for an invalid token, without reading the body", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(404);
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });

  it("responds 413 and destroys the request when the form body exceeds maxBodyBytes", async () => {
    const onDecisionVenta = vi.fn();
    const deps = makeDeps({ onDecisionVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([Buffer.alloc(CONFIG.maxBodyBytes + 1, "a")]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(413);
    expect(req.destroy).toHaveBeenCalled();
    expect(onDecisionVenta).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — indistinguishability (R6) across the 404/generic-page rows", () => {
  it("produces byte-for-byte identical HTML responses for GET-undefined, GET-invalid-token, POST-invalid-decision, and POST-no_aplicable", async () => {
    const respuestas: Array<{ status: number; body: string; contentType: string | undefined }> = [];

    async function capturar(setup: (req: FakeRequest) => void, deps: WebServerDeps): Promise<void> {
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}token-x`, headers: {} });
      setup(req);
      const res = new FakeResponse();
      listener(req, res);
      req.emitBody([]);
      await esperarRespuesta(res);
      respuestas.push({
        status: res.statusCode,
        body: res.end.mock.calls[0]![0] as string,
        contentType: res.headers.get("Content-Type"),
      });
    }

    await capturar(
      (req) => {
        req.method = "GET";
      },
      makeDeps({ onConsultaVenta: vi.fn().mockResolvedValue(undefined) }),
    );
    await capturar(
      (req) => {
        req.method = "GET";
        req.url = `${RUTA_CONFIRMAR_PREFIJO}`;
      },
      makeDeps({ onConsultaVenta: vi.fn() }),
    );
    await capturar(
      (req) => {
        req.method = "POST";
      },
      makeDeps({ onDecisionVenta: vi.fn().mockResolvedValue({ resultado: "no_aplicable", motivo: "carrera" }) }),
    );
    await capturar(
      (req) => {
        req.method = "POST";
      },
      makeDeps({ onDecisionVenta: vi.fn() }),
    );

    const [primero, ...resto] = respuestas;
    if (primero === undefined) {
      throw new Error("no se capturó ninguna respuesta");
    }
    for (const respuesta of resto) {
      expect(respuesta.status).toBe(primero.status);
      expect(respuesta.body).toBe(primero.body);
      expect(respuesta.contentType).toBe(primero.contentType);
    }
    expect(primero.status).toBe(404);
  });

  it("produces byte-for-byte identical JSON responses for /devolucion unknown-token and wrong-state", async () => {
    async function capturar(onDevolucion: WebServerDeps["onDevolucion"]): Promise<{ status: number; body: string }> {
      const deps = makeDeps({ onDevolucion });
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
      const res = new FakeResponse();
      listener(req, res);
      req.emitBody([jsonBody({ token: "token-x" })]);
      await esperarRespuesta(res);
      return { status: res.statusCode, body: res.end.mock.calls[0]![0] as string };
    }

    const desconocido = await capturar(vi.fn().mockResolvedValue({ resultado: "no_aplicable" }));
    const estadoInvalido = await capturar(vi.fn().mockResolvedValue({ resultado: "no_aplicable" }));

    expect(desconocido.status).toBe(404);
    expect(desconocido).toEqual(estadoInvalido);
  });
});

describe("createRequestListener — POST /devolucion", () => {
  it("responds 200 {resultado: 'reembolsada'} below the threshold", async () => {
    const onDevolucion = vi.fn().mockResolvedValue({ resultado: "reembolsada" });
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ token: "token-1" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ resultado: "reembolsada" }));
  });

  it("responds 200 {resultado: 'escalada'} at or above the threshold", async () => {
    const onDevolucion = vi.fn().mockResolvedValue({ resultado: "escalada" });
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ token: "token-1" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ resultado: "escalada" }));
  });

  it("responds 400 with an invalid payload (missing token)", async () => {
    const onDevolucion = vi.fn();
    const deps = makeDeps({ onDevolucion });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_DEVOLUCION, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({})]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(onDevolucion).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /soporte", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responds 200 with {casoId, respuesta} when the turn resolves before the timeout", async () => {
    const onSoporte = vi.fn().mockResolvedValue(SOPORTE_RESULT);
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(SOPORTE_RESULT));
  });

  it("responds 400 with an invalid payload (missing consulta)", async () => {
    const onSoporte = vi.fn();
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({})]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(400);
    expect(onSoporte).not.toHaveBeenCalled();
  });

  it("responds 504 and logs soporte-timeout when the handler takes longer than SOPORTE_TIMEOUT_MS", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onSoporte = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    await vi.advanceTimersByTimeAsync(SOPORTE_TIMEOUT_MS);

    expect(res.statusCode).toBe(504);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "soporte-timeout", expect.anything());

    resolverTurno(SOPORTE_RESULT);
  });

  it("responds 502 and logs soporte-turno-fallido when the handler rejects", async () => {
    const onSoporte = vi.fn().mockRejectedValue(new Error("el modelo rechazó"));
    const deps = makeDeps({ onSoporte });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(502);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "soporte-turno-fallido", expect.anything());
  });
});

describe("startServer — close() drains in-flight /soporte turns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("close() awaits the in-flight /soporte turn via Promise.allSettled before resolving", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onSoporte = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const deps = makeDeps({ onSoporte });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    // Deja avanzar la cola de microtareas para que `handleSoporte` alcance
    // a llamar `onSoporte` (a través del wrapper de drenaje de
    // `startServer`) ANTES de tomar la foto de `enVuelo` en `close()` —
    // si no, `close()` vería el `Set` todavía vacío.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);

    resolverTurno(SOPORTE_RESULT);
    await closePromise;

    expect(closed).toBe(true);
  });

  it("close() resolves after WEB_CLOSE_TIMEOUT_MS even if a turn never settles, and logs web-cierre-con-turnos-en-vuelo", async () => {
    const onSoporte = vi.fn().mockImplementation(() => new Promise<SoporteResult>(() => {}));
    const logEvent = vi.fn();
    const deps = makeDeps({ onSoporte, logEvent });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "hola" })]);

    // Mismo motivo que en el test anterior: dejar que `onSoporte` quede
    // registrado en `enVuelo` antes de llamar `close()`.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(WEB_CLOSE_TIMEOUT_MS);
    await closePromise;

    expect(closed).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      WEB_LOG_CORRELATION_ID,
      "web-cierre-con-turnos-en-vuelo",
      expect.anything(),
    );
  });
});

/**
 * Hallazgo del Reviewer (`operaciones-negocio-conversacionales`): el mismo
 * mecanismo de drenaje que ya protegía `/soporte` (Set `enVuelo` + carrera
 * contra `WEB_CLOSE_TIMEOUT_MS` en `close()`) tenía que cubrir también
 * `/operaciones` -- si un turno seguía en vuelo cuando arrancaba el
 * shutdown, `web.close()` no lo esperaba y una escritura sincrónica de
 * better-sqlite3 podía pegarle a una DB ya cerrada. Mismo molde EXACTO que
 * la suite de `/soporte` de arriba, aplicado a `onOperacionesEmpleado`.
 */
describe("startServer — close() drains in-flight /operaciones turns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function operacionesDeps(overrides: Partial<WebServerDeps> = {}): WebServerDeps {
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    return makeDeps({ sesionStore, ...overrides });
  }

  it("close() awaits the in-flight /operaciones turn via Promise.allSettled before resolving", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onOperacionesEmpleado = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const deps = operacionesDeps({ onOperacionesEmpleado });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);

    // Mismo motivo que en la suite de /soporte: dejar que
    // `onOperacionesEmpleado` quede registrado en `enVuelo` (a través del
    // wrapper de drenaje de `startServer`) antes de tomar la foto en
    // `close()`.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    // Avanza CASI todo el techo de `WEB_CLOSE_TIMEOUT_MS` (no solo un par de
    // microtareas) antes de afirmar que `close()` sigue pendiente -- esto es
    // lo que distingue de verdad "sigue esperando al turno real" de "el Set
    // estaba vacío y ya resolvió por descuido" (un par de `await
    // Promise.resolve()` no alcanza para distinguir ambos casos, porque la
    // cadena `Promise.allSettled([]) → race → resolveClose` también tarda
    // más de un puñado de microtareas en asentarse).
    await vi.advanceTimersByTimeAsync(WEB_CLOSE_TIMEOUT_MS - 1);
    expect(closed).toBe(false);

    resolverTurno(OPERACIONES_RESULT);
    await closePromise;

    expect(closed).toBe(true);
  });

  it("close() resolves after WEB_CLOSE_TIMEOUT_MS even if an /operaciones turn never settles, and logs web-cierre-con-turnos-en-vuelo", async () => {
    const onOperacionesEmpleado = vi.fn().mockImplementation(() => new Promise<SoporteResult>(() => {}));
    const logEvent = vi.fn();
    const deps = operacionesDeps({ onOperacionesEmpleado, logEvent });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();
    getListener()(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);

    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(WEB_CLOSE_TIMEOUT_MS);
    await closePromise;

    expect(closed).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      WEB_LOG_CORRELATION_ID,
      "web-cierre-con-turnos-en-vuelo",
      expect.anything(),
    );
  });
});

/**
 * Regresión + prueba de que `/soporte` y `/operaciones` comparten el MISMO
 * Set `enVuelo` (no dos mecanismos de drenaje independientes) -- si
 * `close()` esperara a `/soporte` y `/operaciones` con dos `Set`s
 * separados, este describe seguiría en verde por casualidad; la prueba
 * combinada de abajo es la que realmente lo distingue.
 */
describe("startServer — close() drenaje compartido entre /soporte y /operaciones", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("close() with no turns in flight of either kind resolves immediately", async () => {
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const deps = makeDeps({ sesionStore });
    const { createServer } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    await closePromise;

    expect(closed).toBe(true);
  });

  it("close() awaits a concurrent /soporte turn AND a concurrent /operaciones turn (same drenaje mechanism)", async () => {
    let resolverSoporte!: (value: SoporteResult) => void;
    let resolverOperaciones!: (value: SoporteResult) => void;
    const onSoporte = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverSoporte = resolve;
        }),
    );
    const onOperacionesEmpleado = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverOperaciones = resolve;
        }),
    );
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const deps = makeDeps({ onSoporte, onOperacionesEmpleado, sesionStore });
    const { createServer, getListener } = makeFakeHttpServer();

    const handle = await startServer(deps, createServer);

    const reqSoporte = new FakeRequest({ method: "POST", url: RUTA_SOPORTE, headers: {} });
    const resSoporte = new FakeResponse();
    getListener()(reqSoporte, resSoporte);
    reqSoporte.emitBody([jsonBody({ consulta: "hola" })]);

    const reqOperaciones = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const resOperaciones = new FakeResponse();
    getListener()(reqOperaciones, resOperaciones);
    reqOperaciones.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);

    // Deja que ambos turnos queden registrados en el `enVuelo` compartido
    // antes de tomar la foto en `close()`.
    await vi.advanceTimersByTimeAsync(0);

    let closed = false;
    const closePromise = handle.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);

    // Resolver solo /soporte no alcanza -- close() sigue esperando a
    // /operaciones. Se espera CASI todo el techo (no un par de
    // microtareas) para distinguir de verdad "sigue bloqueado por el turno
    // de /operaciones" de "el Set solo tenía /soporte y ya se vació,
    // /operaciones nunca estuvo ahí" (mismo motivo que en la suite
    // anterior).
    resolverSoporte(SOPORTE_RESULT);
    await vi.advanceTimersByTimeAsync(WEB_CLOSE_TIMEOUT_MS - 1);
    expect(closed).toBe(false);

    resolverOperaciones(OPERACIONES_RESULT);
    await closePromise;

    expect(closed).toBe(true);
  });
});

describe("createRequestListener — POST /login (operaciones-negocio-conversacionales, tarea 9, ADR 173 pto 2)", () => {
  it("responds 200 {token} on valid credentials", async () => {
    const onLogin = vi.fn().mockResolvedValue({ ok: true, token: "token-nuevo" } satisfies LoginHttpResult);
    const deps = makeDeps({ onLogin });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_LOGIN, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ empleadoId: "emp-1", password: "correcta" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ token: "token-nuevo" }));
    expect(onLogin).toHaveBeenCalledWith({ empleadoId: "emp-1", password: "correcta" });
  });

  it("responds 200 {token, expiraEn} when the login result includes an expiration", async () => {
    const onLogin = vi
      .fn()
      .mockResolvedValue({ ok: true, token: "token-nuevo", expiraEn: "2026-01-01T01:00:00.000Z" } satisfies LoginHttpResult);
    const deps = makeDeps({ onLogin });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_LOGIN, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ empleadoId: "emp-1", password: "correcta" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ token: "token-nuevo", expiraEn: "2026-01-01T01:00:00.000Z" }),
    );
  });

  it("responds 401 with the SAME generic message the TUI already uses (ADR 30) on invalid credentials", async () => {
    const onLogin = vi.fn().mockResolvedValue({ ok: false } satisfies LoginHttpResult);
    const deps = makeDeps({ onLogin });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_LOGIN, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ empleadoId: "emp-1", password: "incorrecta" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(401);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: "Credenciales inválidas." }));
  });

  it("responds 400 with an invalid payload (missing password), without calling onLogin", async () => {
    const onLogin = vi.fn();
    const deps = makeDeps({ onLogin });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_LOGIN, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ empleadoId: "emp-1" })]);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(400);
    expect(onLogin).not.toHaveBeenCalled();
  });
});

describe("createRequestListener — POST /operaciones (operaciones-negocio-conversacionales, tarea 9, ADR 172/173 -- riesgo dominante R1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("★ R1: responds 401 without ever calling onOperacionesEmpleado when the Authorization header is missing", async () => {
    const onOperacionesEmpleado = vi.fn();
    const deps = makeDeps({ onOperacionesEmpleado });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: RUTA_OPERACIONES, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(401);
    expect(onOperacionesEmpleado).not.toHaveBeenCalled();
  });

  it("★ R1: responds 401 without ever calling onOperacionesEmpleado when the token does not resolve to any session (inexistente o vencida, indistinguibles)", async () => {
    const onOperacionesEmpleado = vi.fn();
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(undefined) });
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-vencido-o-inexistente" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(401);
    expect(onOperacionesEmpleado).not.toHaveBeenCalled();
    expect(sesionStore.buscar).toHaveBeenCalledWith("token-vencido-o-inexistente");
  });

  it("with a valid token (emitted by /login), invokes the turn with the resolved session -- empleadoId ALWAYS comes from the session, never from the body", async () => {
    const onOperacionesEmpleado = vi.fn().mockResolvedValue(OPERACIONES_RESULT);
    const confirmacionDelEmpleado = fakeConfirmacion();
    const conversacionDelToken = fakeConversacion();
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const confirmacionOperacionesStore = fakeConfirmacionOperacionesStore({
      paraEmpleado: vi.fn().mockReturnValue(confirmacionDelEmpleado),
    });
    const conversacionStore = fakeConversacionStore({
      paraSesion: vi.fn().mockReturnValue(conversacionDelToken),
    });
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();

    listener(req, res);
    // `empleadoId` en el body es ruido deliberado -- el handler NUNCA debe leerlo de acá.
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta", empleadoId: "emp-suplantado" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(sesionStore.buscar).toHaveBeenCalledWith("token-valido");
    expect(confirmacionOperacionesStore.paraEmpleado).toHaveBeenCalledWith(SESION_EMPLEADO.empleadoId);
    // `conversacionStore.paraSesion` se resuelve por el MISMO token que la sesión -- simétrico a `confirmacion` (ADR 196 §2.1).
    expect(conversacionStore.paraSesion).toHaveBeenCalledWith("token-valido");
    expect(onOperacionesEmpleado).toHaveBeenCalledWith({
      consulta: "quiero registrar una venta",
      sesion: SESION_EMPLEADO,
      confirmacion: confirmacionDelEmpleado,
      conversacion: conversacionDelToken,
    });
    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(OPERACIONES_RESULT));
  });

  it("responds 400 with an invalid payload (missing consulta), without calling onOperacionesEmpleado", async () => {
    const onOperacionesEmpleado = vi.fn();
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({})]);
    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(400);
    expect(onOperacionesEmpleado).not.toHaveBeenCalled();
  });

  it("responds 504 and logs operaciones-timeout when the handler takes longer than OPERACIONES_TIMEOUT_MS", async () => {
    let resolverTurno!: (value: SoporteResult) => void;
    const onOperacionesEmpleado = vi.fn().mockImplementation(
      () =>
        new Promise<SoporteResult>((resolve) => {
          resolverTurno = resolve;
        }),
    );
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);

    await vi.advanceTimersByTimeAsync(OPERACIONES_TIMEOUT_MS);

    expect(res.statusCode).toBe(504);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "operaciones-timeout", expect.anything());

    resolverTurno(OPERACIONES_RESULT);
  });

  /**
   * `consulta-kpi-a2a-chat`, tarea 10.2 -- TEST DE CARACTERIZACION, sin codigo de
   * produccion. NACE VERDE por criterio declarado (no es test-first): fija el
   * comportamiento VIGENTE de `handleOperaciones` (`server.ts`, carrera contra
   * `OPERACIONES_TIMEOUT_MS`), el residual R11 (design §0.4): el 504 responde al
   * cliente pero NO cancela el turno; si el handler completa despues, la fila de
   * delegacion y la de auditoria se escriben igual. Un 504 NO significa "no se
   * envio". Sus dientes se prueban por mutacion manual en 12.x.
   */
  it("caracterizacion (R11): un 504 de POST /operaciones no cancela el turno -- consultar_kpi completa despues y deja su fila de delegacion y su fila atendida", async () => {
    const db = openDatabase(":memory:");
    try {
      const ahora = "2026-09-13T10:00:00.000Z";
      const admin: SesionEmpleado = { empleadoId: "admin-1", iniciadaEn: ahora };
      upsertRolEmpleado(db, { empleadoId: admin.empleadoId, rol: ROL_ADMINISTRADOR, ahora });
      createCaso(db, { id: "caso-turno-kpi", tipo: "soporte", estado: "abierto", createdAt: ahora, updatedAt: ahora });
      const respuesta: ResultadoA2A = {
        ok: true,
        a2aTaskId: "task-externa-1",
        estado: "TASK_STATE_COMPLETED",
        resultado: "KPI: valor",
        agenteNombre: "Agente KPI",
        endpoint: "https://agente.example/rpc",
      };
      const clienteA2A: ClienteA2APort = {
        baseUrlDe: () => "https://agente.example",
        delegar: vi.fn<ClienteA2APort["delegar"]>(async () => respuesta),
      };
      const deps = ejecutarDepsR7(db, {
        clienteA2A,
        delegacionA2AStore: createDelegacionA2AStore(db),
        registro: { registrarAccion: (accion) => insertAccionEmpleado(db, accion) },
        rolPort: { buscarRol: (empleadoId) => (empleadoId === admin.empleadoId ? ROL_ADMINISTRADOR : undefined) },
      });
      let liberarTurno!: () => void;
      const compuerta = new Promise<void>((resolve) => {
        liberarTurno = resolve;
      });
      let turnoTerminado: Promise<unknown> = Promise.resolve();
      const onOperacionesEmpleado = vi.fn().mockImplementation(() => {
        const turno = (async (): Promise<SoporteResult> => {
          await compuerta;
          await ejecutarOperacion(
            {
              operacion: { operacion: OPERACION_CONSULTAR_KPI, consultaId: CONSULTAS_KPI[0] } as EjecutarOperacionInput["operacion"],
              sesion: admin,
              confirmacion: { estaConfirmada: () => false, marcarPendiente: () => undefined, consumir: () => undefined },
              casoIdActual: "caso-turno-kpi",
            },
            deps,
          );
          return OPERACIONES_RESULT;
        })();
        turnoTerminado = turno;
        return turno;
      });
      const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(admin) });
      const listener = createRequestListener(makeDeps({ onOperacionesEmpleado, sesionStore }));
      const req = new FakeRequest({
        method: "POST",
        url: RUTA_OPERACIONES,
        headers: { authorization: "Bearer token-valido" },
      });
      const res = new FakeResponse();

      listener(req, res);
      req.emitBody([jsonBody({ consulta: "consultame el KPI" })]);
      await vi.advanceTimersByTimeAsync(OPERACIONES_TIMEOUT_MS);

      expect(res.statusCode).toBe(504);
      const cuenta = (tabla: string): number =>
        (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
      expect(cuenta("delegaciones_a2a")).toBe(0);

      // El handler completa DESPUES del 504: el turno sigue vivo y escribe igual.
      liberarTurno();
      await turnoTerminado;
      await vi.advanceTimersByTimeAsync(0);

      expect(res.statusCode).toBe(504);
      expect(cuenta("delegaciones_a2a")).toBe(1);
      const acciones = db
        .prepare("SELECT resultado FROM registro_acciones_empleado WHERE comando = ?")
        .all("/consultar-kpi") as { resultado: string }[];
      expect(acciones).toEqual([{ resultado: "atendida" }]);
    } finally {
      db.close();
    }
  });

  it("responds 502 and logs operaciones-turno-fallido when the handler rejects", async () => {
    const onOperacionesEmpleado = vi.fn().mockRejectedValue(new Error("el modelo rechazó"));
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);

    await vi.advanceTimersByTimeAsync(0);

    expect(res.statusCode).toBe(502);
    expect(deps.logEvent).toHaveBeenCalledWith(REQUEST_ID, "operaciones-turno-fallido", expect.anything());
  });

  it("★ REGRESIÓN EXPLÍCITA (R1, no opcional): con la ruta hermana /operaciones ya cableada, el agente conversacional de /soporte (cliente, anónimo) sigue SIN la tool de operaciones", () => {
    const agenteConversacional = getAgentDefinition(CONVERSATIONAL_AGENT_ID);

    expect(agenteConversacional).toBeDefined();
    expect(agenteConversacional?.allowedTools).not.toContain(OPERACIONES_TOOL_QUALIFIED_NAME);
  });

  /**
   * chat-web-empleado, tarea 4 — punto obligatorio 2: el origen del "caso
   * anterior" NUNCA viene del cliente (spec `memoria-conversacional-empleado`).
   */
  it("punto obligatorio 2: un campo 'conversacionId' inventado en el body NO cambia qué token resuelve conversacionStore.paraSesion", async () => {
    const onOperacionesEmpleado = vi.fn().mockResolvedValue(OPERACIONES_RESULT);
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const conversacionStore = fakeConversacionStore();
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const res = new FakeResponse();

    listener(req, res);
    // Fuzz simple: un campo inventado en el body, del todo ajeno al payload esperado, no tiene efecto.
    req.emitBody([
      jsonBody({ consulta: "quiero registrar una venta", conversacionId: "conversacion-ajena-inventada" }),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(conversacionStore.paraSesion).toHaveBeenCalledTimes(1);
    expect(conversacionStore.paraSesion).toHaveBeenCalledWith("token-valido");
    expect(res.statusCode).toBe(200);
  });

  it("el evento logueado tras un turno exitoso incluye conversacionId pero NUNCA el token", async () => {
    const onOperacionesEmpleado = vi.fn().mockResolvedValue(OPERACIONES_RESULT);
    const conversacionDelToken = fakeConversacion({ conversacionId: vi.fn().mockReturnValue("conv-log-1") });
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const conversacionStore = fakeConversacionStore({
      paraSesion: vi.fn().mockReturnValue(conversacionDelToken),
    });
    const logEvent = vi.fn();
    const deps = makeDeps({ onOperacionesEmpleado, sesionStore, conversacionStore, logEvent });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-secreto-nunca-logueado" },
    });
    const res = new FakeResponse();

    listener(req, res);
    req.emitBody([jsonBody({ consulta: "quiero registrar una venta" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(logEvent).toHaveBeenCalledWith(
      OPERACIONES_RESULT.casoId,
      "operaciones-conversacion",
      expect.objectContaining({ conversacionId: "conv-log-1" }),
    );
    for (const llamada of logEvent.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain("token-secreto-nunca-logueado");
    }
  });
});

/**
 * `chat-web-empleado`, tarea 6 (ADR 201 pto 4-7, ADR 202) -- `POST /logout`.
 * Orden exacto de composición: `sesionStore.buscar` (el `empleadoId` sólo se
 * puede leer mientras la sesión existe) → `confirmacionOperacionesStore` →
 * `conversacionStore.eliminar` → `sesionStore.eliminar` → `204` SIEMPRE.
 */
describe("createRequestListener — POST /logout (chat-web-empleado, tarea 6, ADR 201 pto 4-7, ADR 202)", () => {
  it("token válido -- responde 204 y compone las tres piezas de estado en el orden exacto (confirmacion, conversacion, sesion)", async () => {
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(SESION_EMPLEADO) });
    const confirmacionOperacionesStore = fakeConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: { authorization: "Bearer token-valido" } });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledWith();
    expect(req.resume).toHaveBeenCalled();
    expect(sesionStore.buscar).toHaveBeenCalledWith("token-valido");
    // aprobacion-conversacional-hitl, tarea 4 (ADR 214 pto 4): limpiarEmpleado reemplaza paraEmpleado(...).consumir().
    expect(confirmacionOperacionesStore.limpiarEmpleado).toHaveBeenCalledWith(SESION_EMPLEADO.empleadoId);
    expect(conversacionStore.eliminar).toHaveBeenCalledWith("token-valido");
    expect(sesionStore.eliminar).toHaveBeenCalledWith("token-valido");

    // Orden: se limpia la confirmación ANTES que conversacionStore.eliminar, que va ANTES que sesionStore.eliminar.
    const ordenLimpiar = (confirmacionOperacionesStore.limpiarEmpleado as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const ordenConversacion = (conversacionStore.eliminar as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const ordenSesion = (sesionStore.eliminar as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(ordenLimpiar).toBeDefined();
    expect(ordenConversacion).toBeDefined();
    expect(ordenSesion).toBeDefined();
    expect(ordenLimpiar as number).toBeLessThan(ordenConversacion as number);
    expect(ordenConversacion as number).toBeLessThan(ordenSesion as number);
  });

  /**
   * Hallazgo Reviewer 2da ronda #1 (CRÍTICO): `confirmacionOperacionesStore`
   * está keyeado por `empleadoId`, no por sesión -- dos sesiones concurrentes
   * del mismo empleado no deben pisarse la confirmación pendiente al cerrar
   * UNA de ellas.
   */
  it("empleado con OTRA sesión vigente -- logout de una NO limpia las confirmaciones de la otra, pero sigue limpiando conversacion/sesion por token", async () => {
    const sesionStore = fakeSesionStore({
      buscar: vi.fn().mockReturnValue(SESION_EMPLEADO),
      otraSesionVigente: vi.fn().mockReturnValue(true),
    });
    const confirmacionOperacionesStore = fakeConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: { authorization: "Bearer token-b" } });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    expect(sesionStore.otraSesionVigente).toHaveBeenCalledWith(SESION_EMPLEADO.empleadoId, "token-b");
    expect(confirmacionOperacionesStore.limpiarEmpleado).not.toHaveBeenCalled();
    expect(conversacionStore.eliminar).toHaveBeenCalledWith("token-b");
    expect(sesionStore.eliminar).toHaveBeenCalledWith("token-b");
  });

  /**
   * aprobacion-conversacional-hitl, tarea 4 (spec `confirmacion-operaciones-
   * multislot`, "El logout limpia todas las ranuras pendientes del
   * empleado"). Con la ranura multi-slot, dos confirmaciones pendientes de
   * DOMINIOS distintos (reembolso y solicitud) para el MISMO empleado deben
   * quedar ambas limpias tras un único logout -- no sólo la última invocada.
   */
  it("dos confirmaciones pendientes de dominios distintos -- logout limpia AMBAS, no sólo una", async () => {
    const empleadoId = "emp-multislot";
    const sesionStore = crearSesionEmpleadoStore(0);
    const confirmacionOperacionesStore = crearConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const token = sesionStore.crear({ empleadoId, iniciadaEn: new Date().toISOString() });

    const llaveReembolso: LlaveConfirmacion = { dominio: DOMINIO_REEMBOLSO, itemId: "V1", accion: "aprobar" };
    const llaveSolicitud: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "cancelar" };
    const confirmacion = confirmacionOperacionesStore.paraEmpleado(empleadoId);
    confirmacion.marcarPendiente({ ...llaveReembolso, casoId: "caso-reembolso", empleadoId, origenCasoId: "caso-0" });
    confirmacion.marcarPendiente({ ...llaveSolicitud, casoId: "caso-solicitud", empleadoId, origenCasoId: "caso-0" });

    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: { authorization: `Bearer ${token}` } });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    // Tras un login nuevo (mismo empleadoId), ninguna de las dos sigue pendiente.
    expect(confirmacion.estaConfirmada(llaveReembolso, empleadoId, "caso-nuevo")).toBe(false);
    expect(confirmacion.estaConfirmada(llaveSolicitud, empleadoId, "caso-nuevo")).toBe(false);
  });

  it("dos sesiones reales del mismo empleado -- logout de la sesión B no invalida la confirmación pendiente de la sesión A", async () => {
    const empleadoId = "emp-concurrente";
    const sesionStore = crearSesionEmpleadoStore(0);
    const confirmacionOperacionesStore = crearConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const tokenA = sesionStore.crear({ empleadoId, iniciadaEn: new Date().toISOString() });
    const tokenB = sesionStore.crear({ empleadoId, iniciadaEn: new Date().toISOString() });

    // Sesión A tiene una confirmación pendiente marcada (simula un turno previo).
    const llaveCancelarSol1: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "cancelar" };
    confirmacionOperacionesStore.paraEmpleado(empleadoId).marcarPendiente({
      ...llaveCancelarSol1,
      casoId: "caso-1",
      empleadoId,
      origenCasoId: "caso-0",
    });

    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: { authorization: `Bearer ${tokenB}` } });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    // B quedó deslogueado igual.
    expect(sesionStore.buscar(tokenB)).toBeUndefined();
    // La confirmación pendiente de A SIGUE viva -- un turno posterior en un
    // caso nuevo la sigue viendo como confirmada (mismo criterio que
    // `estaConfirmada`, ADR 166 pto 3).
    expect(
      confirmacionOperacionesStore.paraEmpleado(empleadoId).estaConfirmada(llaveCancelarSol1, empleadoId, "caso-nuevo"),
    ).toBe(true);
  });

  it("empleado con UNA sola sesión (caso normal) -- logout limpia la confirmación igual que antes, sin regresión", async () => {
    const empleadoId = "emp-solo";
    const sesionStore = crearSesionEmpleadoStore(0);
    const confirmacionOperacionesStore = crearConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const token = sesionStore.crear({ empleadoId, iniciadaEn: new Date().toISOString() });

    const llaveCancelarSol1: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "cancelar" };
    confirmacionOperacionesStore.paraEmpleado(empleadoId).marcarPendiente({
      ...llaveCancelarSol1,
      casoId: "caso-1",
      empleadoId,
      origenCasoId: "caso-0",
    });

    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: { authorization: `Bearer ${token}` } });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    expect(
      confirmacionOperacionesStore.paraEmpleado(empleadoId).estaConfirmada(llaveCancelarSol1, empleadoId, "caso-nuevo"),
    ).toBe(false);
  });

  it("un token usado tras logout es indistinguible de uno vencido -- POST /operaciones posterior da 401", async () => {
    vi.useFakeTimers();
    const sesiones = new Map<string, SesionEmpleado>([["token-valido", SESION_EMPLEADO]]);
    const sesionStore = fakeSesionStore({
      buscar: vi.fn((token: string) => sesiones.get(token)),
      eliminar: vi.fn((token: string) => {
        sesiones.delete(token);
      }),
    });
    const onOperacionesEmpleado = vi.fn();
    const deps = makeDeps({ sesionStore, onOperacionesEmpleado });
    const listener = createRequestListener(deps);

    const logoutReq = new FakeRequest({
      method: "POST",
      url: "/logout",
      headers: { authorization: "Bearer token-valido" },
    });
    const logoutRes = new FakeResponse();
    listener(logoutReq, logoutRes);
    await esperarRespuesta(logoutRes);
    expect(logoutRes.statusCode).toBe(204);

    const operacionesReq = new FakeRequest({
      method: "POST",
      url: RUTA_OPERACIONES,
      headers: { authorization: "Bearer token-valido" },
    });
    const operacionesRes = new FakeResponse();
    listener(operacionesReq, operacionesRes);
    operacionesReq.emitBody([jsonBody({ consulta: "hola" })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(operacionesRes.statusCode).toBe(401);
    expect(onOperacionesEmpleado).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each([
    ["vencido/inexistente", "Bearer token-vencido-o-inexistente"],
    ["ausente", undefined],
  ])("token %s -- responde 204 igual (punto obligatorio 8)", async (_label, authHeaderValue) => {
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(undefined) });
    const confirmacionOperacionesStore = fakeConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: "/logout",
      headers: authHeaderValue === undefined ? {} : { authorization: authHeaderValue },
    });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    expect(req.resume).toHaveBeenCalled();
    expect(confirmacionOperacionesStore.paraEmpleado).not.toHaveBeenCalled();
  });

  it("token inexistente -- conversacionStore.eliminar y sesionStore.eliminar igual se invocan (idempotentes), sin consumir confirmacion", async () => {
    const sesionStore = fakeSesionStore({ buscar: vi.fn().mockReturnValue(undefined) });
    const confirmacionOperacionesStore = fakeConfirmacionOperacionesStore();
    const conversacionStore = fakeConversacionStore();
    const deps = makeDeps({ sesionStore, confirmacionOperacionesStore, conversacionStore });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({
      method: "POST",
      url: "/logout",
      headers: { authorization: "Bearer token-vencido-o-inexistente" },
    });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(204);
    expect(conversacionStore.eliminar).toHaveBeenCalledWith("token-vencido-o-inexistente");
    expect(sesionStore.eliminar).toHaveBeenCalledWith("token-vencido-o-inexistente");
    expect(confirmacionOperacionesStore.paraEmpleado).not.toHaveBeenCalled();
  });

  it("no lee el body pero lo drena (req.resume) antes de responder", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "POST", url: "/logout", headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(req.resume).toHaveBeenCalled();
  });

  it("método equivocado sobre /logout (GET) -- 404 vacío, sin caso especial", () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: "/logout", headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });
});

/**
 * `chat-web-empleado`, tarea 10 (ADR 199, ADR 201) -- `GET /chat`,
 * `GET /chat/app.js`, `GET /chat/app.css`. Públicas (sin sesión), CSP vía
 * `respondHtmlChat` (que delega en `respondHtml` SIN modificarlo -- ver el
 * describe de `GET /confirmar/:token` más abajo para la verificación
 * negativa) más `respondAsset` para los dos assets estáticos.
 */
describe("createRequestListener — GET /chat, GET /chat/app.js, GET /chat/app.css (chat-web-empleado, tarea 10)", () => {
  it("GET /chat -- 200, text/html, CSP literal exacta y X-Content-Type-Options: nosniff, sin sesión", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: RUTA_CHAT, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toEqual(CSP_CHAT);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.end).toHaveBeenCalledWith(renderChatHtml());
  });

  it("GET /chat/app.js -- 200, application/javascript, mismos headers de seguridad", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: RUTA_CHAT_SCRIPT, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toEqual(CSP_CHAT);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Request-Id")).toBe(REQUEST_ID);
    expect(res.end).toHaveBeenCalledWith(CHAT_CLIENT_JS);
  });

  it("GET /chat/app.css -- 200, text/css, mismos headers de seguridad", async () => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: RUTA_CHAT_ESTILOS, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toEqual(CSP_CHAT);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.end).toHaveBeenCalledWith(CHAT_CSS);
  });

  it.each([RUTA_CHAT, RUTA_CHAT_SCRIPT, RUTA_CHAT_ESTILOS])(
    "%s responde igual sin sesión -- público, sin datos de negocio (no consulta ningún store)",
    async (ruta) => {
      const sesionStore = fakeSesionStore();
      const deps = makeDeps({ sesionStore });
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "GET", url: ruta, headers: {} });
      const res = new FakeResponse();

      listener(req, res);
      await esperarRespuesta(res);

      expect(res.statusCode).toBe(200);
      expect(sesionStore.buscar).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["POST", RUTA_CHAT],
    ["POST", RUTA_CHAT_SCRIPT],
    ["POST", RUTA_CHAT_ESTILOS],
  ])("método equivocado (%s %s) -- 404 vacío, sin caso especial", (metodo, ruta) => {
    const deps = makeDeps();
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: metodo, url: ruta, headers: {} });
    const res = new FakeResponse();

    listener(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it.each([
    ["GET /chat", RUTA_CHAT],
    ["GET /chat/app.js", RUTA_CHAT_SCRIPT],
    ["GET /chat/app.css", RUTA_CHAT_ESTILOS],
  ])(
    "%s no setea headers después de end() -- doble estricto (hallazgo Reviewer, ERR_HTTP_HEADERS_SENT)",
    async (_nombre, ruta) => {
      const deps = makeDeps();
      const listener = createRequestListener(deps);
      const req = new FakeRequest({ method: "GET", url: ruta, headers: {} });
      const res = new StrictFakeResponse();

      expect(() => listener(req, res)).not.toThrow();
      await esperarRespuesta(res as unknown as FakeResponse);

      expect(res.statusCode).toBe(200);
      expect(res.headers.get("Content-Security-Policy")).toEqual(CSP_CHAT);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    },
  );

  it("GET /confirmar/:token NO gana la cabecera CSP -- respondHtml sigue sin tocar (verificación negativa)", async () => {
    const onConsultaVenta = vi.fn().mockResolvedValue(VENTA_PUBLICA);
    const deps = makeDeps({ onConsultaVenta });
    const listener = createRequestListener(deps);
    const req = new FakeRequest({ method: "GET", url: `${RUTA_CONFIRMAR_PREFIJO}token-1`, headers: {} });
    const res = new FakeResponse();

    listener(req, res);
    await esperarRespuesta(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBeUndefined();
    expect(res.headers.get("X-Content-Type-Options")).toBeUndefined();
  });
});
