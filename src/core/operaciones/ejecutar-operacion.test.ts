import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DOMINIO_REEMBOLSO,
  DOMINIO_SOLICITUD,
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_RESOLVER_DECISION_VENTA,
  OPERACION_RESOLVER_REEMBOLSO,
  OPERACION_RESOLVER_SOLICITUD,
  type ConfirmacionOperacionPort,
  type LlaveConfirmacion,
  type OperacionNegocio,
} from "./operaciones-contract.js";
import { ejecutarOperacion, type EjecutarOperacionDeps } from "./ejecutar-operacion.js";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_REEMBOLSADA,
  type CrearVentaConCasoInput,
  type EscalacionListada,
  type NotificacionResultado,
  type Venta,
  type VentaNotifierPort,
  type VentaStorePort,
} from "../ventas/ventas-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_TIPO_GASTO,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "../solicitudes/solicitudes-contract.js";
import type { DelegacionStorePort, DespacharDelegacionDeps } from "../turn-selector/dispatch-delegation.js";
import { getSubagentDefinition } from "../agents/definitions.js";
import type { InvocacionSubagenteResult, InvocarSubagente } from "../agents/subagents.js";
import type { ComisionConVenta, VentaPendienteReembolso } from "../ventas/reporte.js";
import type { ReporteStorePort } from "../ventas/reporte-contract.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "../auth/rol-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";
import {
  COMANDO_APROBAR_REEMBOLSO,
  COMANDO_APROBAR_SOLICITUD,
  COMANDO_CANCELAR_SOLICITUD,
  COMANDO_DEVOLUCION,
  COMANDO_RECHAZAR_REEMBOLSO,
  COMANDO_RECHAZAR_SOLICITUD,
  COMANDO_REGISTRAR_VENTA,
  COMANDO_REPORTE_COMISIONES,
  COMANDO_RESOLVER_DECISION_VENTA,
  COMANDO_SOLICITAR,
  RESULTADO_ATENDIDA,
  RESULTADO_AUTOAPROBACION_PROHIBIDA,
  RESULTADO_CONFIRMADA,
  RESULTADO_CREADA,
  RESULTADO_ESCALADA,
  RESULTADO_NO_APLICABLE,
  RESULTADO_NO_AUTORIZADO,
  RESULTADO_RECHAZADA,
  RESULTADO_REEMBOLSADA,
  type AccionEmpleado,
  type RegistroAccionesEmpleadoPort,
} from "../commands/registro-acciones-contract.js";

/**
 * operaciones-negocio-conversacionales, tarea 3. Dobles de `VentaStorePort`/
 * `SolicitudStorePort`/`ReporteStorePort`/`DespacharDelegacionDeps` — nunca
 * SQLite real, mismo criterio que el resto de `src/core/`. Los cinco bloques
 * obligatorios de `tasks.md` tarea 3 están cubiertos, cada uno en su propio
 * `describe`.
 */

const AHORA = "2026-09-13T10:00:00.000Z";
const SESION: SesionEmpleado = { empleadoId: "empleado-1", iniciadaEn: "2026-09-13T09:00:00.000Z" };
const CASO_ACTUAL = "caso-turno-1";

function buildVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: "venta-1",
    vendedorId: "empleado-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 1000,
    estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
    casoId: "caso-venta-1",
    tokenConfirmacion: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeVentaStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  return {
    crearVentaConCaso: vi.fn((input: CrearVentaConCasoInput) => ({
      id: input.venta.id,
      vendedorId: input.vendedor.id,
      clienteId: input.venta.clienteId,
      ...(input.venta.planAnterior !== undefined ? { planAnterior: input.venta.planAnterior } : {}),
      planNuevo: input.venta.planNuevo,
      monto: input.venta.monto,
      estado: input.venta.estado,
      casoId: input.caso.id,
      tokenConfirmacion: input.venta.tokenConfirmacion,
      createdAt: input.timestamp,
      ...(input.venta.expiresAt !== undefined ? { expiresAt: input.venta.expiresAt } : {}),
    })),
    buscarVentaPorToken: vi.fn(() => buildVenta()),
    confirmarVentaConComision: vi.fn(() => undefined),
    rechazarVenta: vi.fn(() => undefined),
    aprobarReembolso: vi.fn(() => undefined),
    escalarReembolso: vi.fn(() => undefined),
    listarReembolsosPendientes: vi.fn(() => []),
    listarReembolsosRechazados: vi.fn(() => []),
    aprobarEscalacionReembolso: vi.fn(() => undefined),
    rechazarEscalacionReembolso: vi.fn(() => undefined),
    reabrirEscalacionReembolso: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeNotifier(overrides: Partial<VentaNotifierPort> = {}): VentaNotifierPort {
  return {
    notificarLinkConfirmacion: vi.fn(async (): Promise<NotificacionResultado> => ({ enviado: true })),
    ...overrides,
  };
}

function buildEscalacion(overrides: Partial<EscalacionListada> = {}): EscalacionListada {
  return {
    ventaId: "venta-1",
    vendedorId: "empleado-1",
    vendedorNombre: "Vendedor Uno",
    clienteId: "cliente-1",
    monto: 1000,
    casoId: "caso-venta-1",
    reaperturasPrevias: 0,
    ...overrides,
  };
}

function buildSolicitud(overrides: Partial<SolicitudInterna> = {}): SolicitudInterna {
  return {
    id: "solicitud-1",
    casoId: "caso-solicitud-1",
    solicitanteId: "empleado-1",
    tipo: SOLICITUD_TIPO_GASTO,
    detalle: "taxi al cliente",
    estado: SOLICITUD_ESTADO_PENDIENTE,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSolicitudStore(overrides: Partial<SolicitudStorePort> = {}): SolicitudStorePort {
  return {
    crearSolicitudConCaso: vi.fn((input) => ({
      id: input.solicitud.id,
      casoId: input.caso.id,
      solicitanteId: input.solicitud.solicitanteId,
      tipo: input.solicitud.tipo,
      detalle: input.solicitud.detalle,
      estado: input.solicitud.estado,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })),
    adjuntarDictamen: vi.fn(() => undefined),
    listarSolicitudesPendientes: vi.fn(() => [buildSolicitud()]),
    aprobarSolicitud: vi.fn(() => undefined),
    rechazarSolicitud: vi.fn(() => undefined),
    cancelarSolicitud: vi.fn(() => buildSolicitud({ estado: SOLICITUD_ESTADO_CANCELADA })),
    ...overrides,
  };
}

function makeDelegacionStore(): DelegacionStorePort {
  return { crearDelegacion: vi.fn(), completarDelegacion: vi.fn() };
}

function makeInvocar(resultado: InvocacionSubagenteResult): InvocarSubagente {
  return vi.fn(async () => resultado);
}

function makeDespacharDeps(overrides: Partial<DespacharDelegacionDeps> = {}): DespacharDelegacionDeps {
  let contador = 0;
  return {
    store: makeDelegacionStore(),
    invocar: makeInvocar({ responseText: "dictamen del validador", sdkSessionId: "sdk-validador" }),
    getSubagente: getSubagentDefinition,
    newId: vi.fn(() => `id-${contador++}`),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

function makeReporteStore(overrides: Partial<ReporteStorePort> = {}): ReporteStorePort {
  return {
    listComisionesPorPeriodo: vi.fn((): readonly ComisionConVenta[] => []),
    listVentasEnReembolsoPendiente: vi.fn((): readonly VentaPendienteReembolso[] => []),
    ...overrides,
  };
}

function makeRolPort(rol: RolEmpleado | undefined = ROL_ADMINISTRADOR): RolEmpleadoPort {
  return { buscarRol: () => rol };
}

function makeConfirmacion(overrides: Partial<ConfirmacionOperacionPort> = {}): ConfirmacionOperacionPort {
  return {
    estaConfirmada: vi.fn(() => false),
    marcarPendiente: vi.fn(),
    consumir: vi.fn(),
    ...overrides,
  };
}

/** operaciones-negocio-conversacionales, tarea 16 (ADR 188/RD-87) — doble que captura las llamadas a `registrarAccion`. */
function makeRegistro(overrides: Partial<RegistroAccionesEmpleadoPort> = {}): RegistroAccionesEmpleadoPort {
  return {
    registrarAccion: vi.fn((_accion: AccionEmpleado) => undefined),
    ...overrides,
  };
}

let idCounter = 0;

function makeDeps(overrides: Partial<EjecutarOperacionDeps> = {}): EjecutarOperacionDeps {
  return {
    store: makeVentaStore(),
    solicitudStore: makeSolicitudStore(),
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72, ventaGrandeUmbral: 5000 },
    notifier: makeNotifier(),
    baseUrlPublica: "https://ventas.example.com",
    reporteStore: makeReporteStore(),
    despacharDeps: makeDespacharDeps(),
    rolPort: makeRolPort(),
    registro: makeRegistro(),
    newId: vi.fn(() => `id-${idCounter++}`),
    newToken: vi.fn(() => `token-${idCounter++}`),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

function makeInput(operacion: OperacionNegocio, overrides: Partial<{ sesion: SesionEmpleado; confirmacion: ConfirmacionOperacionPort; casoIdActual: string }> = {}) {
  return {
    operacion,
    sesion: SESION,
    confirmacion: makeConfirmacion(),
    casoIdActual: CASO_ACTUAL,
    ...overrides,
  };
}

/* ── Bloque 1: las 6 operaciones, ninguna lanza en ningún camino de error ── */

describe("ejecutarOperacion — nunca lanza (contrato, molde handleKnowledgeQuery)", () => {
  it("resolver_decision_venta con token inexistente no lanza", async () => {
    const store = makeVentaStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_DECISION_VENTA, token: "no-existe", decision: "confirmar" }),
      deps,
    );

    expect(typeof texto).toBe("string");
  });

  it("procesar_devolucion con token inexistente no lanza", async () => {
    const store = makeVentaStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "no-existe" }),
      deps,
    );

    expect(typeof texto).toBe("string");
  });

  it("crear_solicitud_interna con tipo desconocido no lanza", async () => {
    const deps = makeDeps();

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CREAR_SOLICITUD_INTERNA, tipo: "tipo-inventado", detalle: "x" }),
      deps,
    );

    expect(typeof texto).toBe("string");
  });

  it("cancelar_solicitud_interna con id inexistente no lanza", async () => {
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => []) });
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "no-existe" }),
      deps,
    );

    expect(typeof texto).toBe("string");
  });

  it("registrar_venta con store que lanza sincrónicamente no propaga — se traduce a texto degradado", async () => {
    const store = makeVentaStore({
      crearVentaConCaso: vi.fn(() => {
        throw new Error("fallo de escritura");
      }),
    });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({
        operacion: OPERACION_REGISTRAR_VENTA,
        clienteId: "cliente-1",
        clienteEmail: "cliente@example.com",
        planNuevo: "premium",
        monto: 100,
        vendedorNombre: "Juan Pérez",
      }),
      deps,
    );

    expect(typeof texto).toBe("string");
    expect(deps.logEvent).toHaveBeenCalledWith(
      CASO_ACTUAL,
      "operacion-fallida",
      expect.objectContaining({ operacion: "registrar_venta" }),
    );
  });

  it("consultar_reporte_comisiones con periodo inválido no lanza", async () => {
    const deps = makeDeps();

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "no-es-un-periodo" }),
      deps,
    );

    expect(typeof texto).toBe("string");
  });
});

/* ── Bloque 2 (ADR 170 pto 5): registrar_venta — monto verbatim, vendedorId de la sesión ── */

describe("ejecutarOperacion — registrar_venta (ADR 170 pto 5, ADR 171 pto 2)", () => {
  it("input.monto llega a crearVentaConCaso SIN ninguna operación aritmética (=== estricto)", async () => {
    const store = makeVentaStore();
    const deps = makeDeps({ store });
    const montoDeclarado = 1234.56;

    await ejecutarOperacion(
      makeInput({
        operacion: OPERACION_REGISTRAR_VENTA,
        clienteId: "cliente-1",
        clienteEmail: "cliente@example.com",
        planNuevo: "premium",
        monto: montoDeclarado,
        vendedorNombre: "Juan Pérez",
      }),
      deps,
    );

    expect(store.crearVentaConCaso).toHaveBeenCalledTimes(1);
    const inputRecibido = vi.mocked(store.crearVentaConCaso).mock.calls[0]?.[0] as CrearVentaConCasoInput;
    // `===` estricto contra el valor de entrada — ninguna transformación, ni redondeo.
    expect(inputRecibido.venta.monto).toBe(montoDeclarado);
  });

  it("vendedorId que recibe crearVentaConCaso viene de sesion.empleadoId, NUNCA de un campo del input simulado", async () => {
    const store = makeVentaStore();
    const deps = makeDeps({ store });
    const sesionDistinta: SesionEmpleado = { empleadoId: "empleado-real", iniciadaEn: AHORA };

    await ejecutarOperacion(
      makeInput(
        {
          operacion: OPERACION_REGISTRAR_VENTA,
          clienteId: "cliente-1",
          clienteEmail: "cliente@example.com",
          planNuevo: "premium",
          monto: 100,
          vendedorNombre: "Juan Pérez",
        },
        { sesion: sesionDistinta },
      ),
      deps,
    );

    const inputRecibido = vi.mocked(store.crearVentaConCaso).mock.calls[0]?.[0] as CrearVentaConCasoInput;
    expect(inputRecibido.vendedor.id).toBe("empleado-real");
    // `OperacionRegistrarVenta` no tiene campo `vendedorId` (garantía estructural, ver operaciones-contract.test.ts).
  });

  it("alta exitosa notifica y devuelve texto con el id de la venta y del caso", async () => {
    const deps = makeDeps();

    const texto = await ejecutarOperacion(
      makeInput({
        operacion: OPERACION_REGISTRAR_VENTA,
        clienteId: "cliente-1",
        clienteEmail: "cliente@example.com",
        planNuevo: "premium",
        monto: 100,
        vendedorNombre: "Juan Pérez",
      }),
      deps,
    );

    expect(deps.notifier.notificarLinkConfirmacion).toHaveBeenCalledTimes(1);
    expect(texto).toContain("registrada");
  });
});

/* ── Bloque 3 (ADR 166): cancelar_solicitud_interna — doble paso con ConfirmacionOperacionPort ── */

/** `aprobacion-conversacional-hitl`, tarea 3 (ADR 214 pto 1) — `ejecutarCancelarSolicitud` migró a `LlaveConfirmacion`, `dominio: "solicitud"` + `accion: "cancelar"`, cero convivencia con la forma vieja. */
const LLAVE_CANCELAR_SOL_1: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "cancelar" };

describe("ejecutarOperacion — cancelar_solicitud_interna (ADR 166)", () => {
  it("sin solicitudId ⇒ listado, SIN tocar la ranura de confirmación", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", detalle: "una semana en marzo" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion();
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA }, { confirmacion }),
      deps,
    );

    expect(texto).toContain("sol-1");
    expect(confirmacion.estaConfirmada).not.toHaveBeenCalled();
    expect(confirmacion.marcarPendiente).not.toHaveBeenCalled();
    expect(confirmacion.consumir).not.toHaveBeenCalled();
  });

  it("con solicitudId y estaConfirmada() === false ⇒ requiere_confirmacion + marcarPendiente con origenCasoId", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(confirmacion.estaConfirmada).toHaveBeenCalledWith(LLAVE_CANCELAR_SOL_1, SESION.empleadoId, CASO_ACTUAL);
    expect(confirmacion.marcarPendiente).toHaveBeenCalledWith(
      expect.objectContaining({
        dominio: DOMINIO_SOLICITUD,
        itemId: "sol-1",
        accion: "cancelar",
        casoId: "caso-solicitud-1",
        empleadoId: SESION.empleadoId,
        origenCasoId: CASO_ACTUAL,
      }),
    );
    expect(confirmacion.consumir).not.toHaveBeenCalled();
    expect(solicitudStore.cancelarSolicitud).not.toHaveBeenCalled();
    expect(texto).toContain("Confirmá");
  });

  it("con estaConfirmada() === true ⇒ ejecuta la cancelación y llama consumir()", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(confirmacion.consumir).toHaveBeenCalledTimes(1);
    expect(confirmacion.consumir).toHaveBeenCalledWith(LLAVE_CANCELAR_SOL_1);
    expect(solicitudStore.cancelarSolicitud).toHaveBeenCalledTimes(1);
    expect(texto).toContain("sol-1");
  });
});

/* ── Bloque 3-bis (ADR 206-207, aprobacion-conversacional-hitl, tarea 9): resolver_solicitud ── */

describe("ejecutarOperacion — resolver_solicitud (ADR 206-207, aprobacion-conversacional-hitl, tarea 9)", () => {
  it("sin solicitudId ⇒ listado, SIN tocar la ranura de confirmación", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", tipo: SOLICITUD_TIPO_GASTO, detalle: "una semana en marzo" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion();
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar" }, { confirmacion }),
      deps,
    );

    expect(texto).toContain("sol-1");
    expect(confirmacion.estaConfirmada).not.toHaveBeenCalled();
    expect(confirmacion.marcarPendiente).not.toHaveBeenCalled();
    expect(confirmacion.consumir).not.toHaveBeenCalled();
  });

  it("con solicitudId y estaConfirmada() === false ⇒ requiere_confirmacion + marcarPendiente con LlaveConfirmacion{dominio:'solicitud', itemId, accion}", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ solicitudStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    const llave: LlaveConfirmacion = { dominio: DOMINIO_SOLICITUD, itemId: "sol-1", accion: "aprobar" };
    expect(confirmacion.estaConfirmada).toHaveBeenCalledWith(llave, SESION.empleadoId, CASO_ACTUAL);
    expect(confirmacion.marcarPendiente).toHaveBeenCalledWith(
      expect.objectContaining({
        dominio: DOMINIO_SOLICITUD,
        itemId: "sol-1",
        accion: "aprobar",
        casoId: "caso-solicitud-1",
        empleadoId: SESION.empleadoId,
        origenCasoId: CASO_ACTUAL,
      }),
    );
    expect(confirmacion.consumir).not.toHaveBeenCalled();
    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(texto).toContain("sol-1");
  });

  it("rol base ⇒ no_autorizado, CERO escrituras en solicitudStore, fila de auditoría del intento con comando:'/aprobar-solicitud'", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1", solicitanteId: "otro-empleado" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_EMPLEADO);
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, rolPort, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(solicitudStore.rechazarSolicitud).not.toHaveBeenCalled();
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_APROBAR_SOLICITUD,
      resultado: RESULTADO_NO_AUTORIZADO,
      casoId: "caso-solicitud-1",
    });
    expect(texto).toContain("No estás autorizado");
  });

  it("rechazar con rol base ⇒ no_autorizado, fila de auditoría con comando:'/rechazar-solicitud'", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1", solicitanteId: "otro-empleado" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_EMPLEADO);
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, rolPort, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "rechazar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_RECHAZAR_SOLICITUD,
      resultado: RESULTADO_NO_AUTORIZADO,
    });
  });

  it("autoaprobación (solicitanteId === empleadoId) ⇒ autoaprobacion_prohibida, fila de auditoría con RESULTADO_AUTOAPROBACION_PROHIBIDA", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1", solicitanteId: SESION.empleadoId });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_ADMINISTRADOR);
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, rolPort, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_APROBAR_SOLICITUD,
      resultado: RESULTADO_AUTOAPROBACION_PROHIBIDA,
      casoId: "caso-solicitud-1",
    });
    expect(texto).toContain("No podés aprobar tu propia solicitud");
  });

  it("listado sin id ⇒ CERO escrituras (regresión, molde cancelar_solicitud_interna)", async () => {
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => []) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar" }),
      deps,
    );

    expect(solicitudStore.aprobarSolicitud).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(texto).toContain("No hay solicitudes");
  });

  it("confirmado tras eco ⇒ CAS aplica, el dispatcher NO escribe fila del camino feliz (ya la escribe la transacción)", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1", solicitanteId: "otro-empleado" });
    const solicitudStore = makeSolicitudStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => buildSolicitud({ ...solicitud, estado: SOLICITUD_ESTADO_APROBADA })),
    });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(confirmacion.consumir).toHaveBeenCalledTimes(1);
    expect(solicitudStore.aprobarSolicitud).toHaveBeenCalledTimes(1);
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(texto).toContain("sol-1");
  });

  it("★ test mecánico: el archivo fuente no contiene 'autorizacion-resolucion' ni menciona 'puedeResolverAjeno' (ADR 207 pto 2, R2)", () => {
    const sourcePath = fileURLToPath(new URL("./ejecutar-operacion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/autorizacion-resolucion/);
    expect(source).not.toMatch(/puedeResolverAjeno/);
  });
});

/* ── Bloque 3-bis (ADR 206-207, ADR 211, ADR 216, ADR 218): resolver_reembolso, tarea 13 ── */

describe("ejecutarOperacion — resolver_reembolso (ADR 206-207, ADR 211, ADR 216, ADR 218, aprobacion-conversacional-hitl, tarea 13)", () => {
  it("sin ventaId ⇒ listado, SIN tocar la ranura de confirmación", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1" });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion();
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar" }, { confirmacion }),
      deps,
    );

    expect(texto).toContain("venta-1");
    expect(confirmacion.estaConfirmada).not.toHaveBeenCalled();
    expect(confirmacion.marcarPendiente).not.toHaveBeenCalled();
    expect(confirmacion.consumir).not.toHaveBeenCalled();
  });

  it("con ventaId y estaConfirmada() === false ⇒ requiere_confirmacion + marcarPendiente con LlaveConfirmacion{dominio:'reembolso', itemId, accion}", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1" });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    const llave: LlaveConfirmacion = { dominio: DOMINIO_REEMBOLSO, itemId: "venta-1", accion: "aprobar" };
    expect(confirmacion.estaConfirmada).toHaveBeenCalledWith(llave, SESION.empleadoId, CASO_ACTUAL);
    expect(confirmacion.marcarPendiente).toHaveBeenCalledWith(
      expect.objectContaining({
        dominio: DOMINIO_REEMBOLSO,
        itemId: "venta-1",
        accion: "aprobar",
        casoId: "caso-venta-1",
        empleadoId: SESION.empleadoId,
        origenCasoId: CASO_ACTUAL,
      }),
    );
    expect(confirmacion.consumir).not.toHaveBeenCalled();
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(texto).toContain("venta-1");
  });

  it("accion:'reabrir' con estaConfirmada() === false ⇒ eco agrega rechazadaPor/rechazadaAt/reaperturasPrevias (molde reusado de formatearEco de la TUI, hallazgo Reviewer 3)", async () => {
    const venta = buildEscalacion({
      ventaId: "venta-1",
      casoId: "caso-venta-1",
      rechazadaPor: "beto",
      rechazadaAt: "2026-08-30T00:00:00.000Z",
      reaperturasPrevias: 2,
    });
    const store = makeVentaStore({ listarReembolsosRechazados: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "reabrir", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(texto).toBe(
      "Vas a reabrir el reembolso de la venta venta-1 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución. rechazada por beto el 2026-08-30T00:00:00.000Z · reaperturas previas: 2.",
    );
  });

  it("accion:'reabrir' sin rechazadaPor/rechazadaAt previos ⇒ eco usa los fallback 'desconocido'/'fecha desconocida'", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", reaperturasPrevias: 0 });
    const store = makeVentaStore({ listarReembolsosRechazados: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "reabrir", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(texto).toContain("rechazada por desconocido el fecha desconocida · reaperturas previas: 0.");
  });

  it("accion:'aprobar'/'rechazar' con estaConfirmada() === false ⇒ eco NO agrega la salvedad de reabrir", async () => {
    const venta = buildEscalacion({
      ventaId: "venta-1",
      casoId: "caso-venta-1",
      rechazadaPor: "beto",
      rechazadaAt: "2026-08-30T00:00:00.000Z",
      reaperturasPrevias: 2,
    });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(texto).toBe(
      "Vas a aprobar el reembolso de la venta venta-1 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.",
    );
  });

  it("rol base ⇒ no_autorizado, CERO escrituras en store, fila de auditoría del intento con comando:'/aprobar-reembolso'", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", vendedorId: "otro-empleado" });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_EMPLEADO);
    const registro = makeRegistro();
    const deps = makeDeps({ store, rolPort, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_APROBAR_REEMBOLSO,
      resultado: RESULTADO_NO_AUTORIZADO,
      casoId: "caso-venta-1",
      ventaId: "venta-1",
    });
    // Texto literal reusado de la TUI (ADR 216 pto 5, build-on-comando-empleado.ts:1080) — NO reescrito.
    expect(texto).toBe("No estás autorizado para aprobar esa escalación de reembolso: se requiere rol elevado.");
  });

  it("rechazar con rol base ⇒ no_autorizado, fila de auditoría con comando:'/rechazar-reembolso'", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", vendedorId: "otro-empleado" });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_EMPLEADO);
    const registro = makeRegistro();
    const deps = makeDeps({ store, rolPort, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "rechazar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_RECHAZAR_REEMBOLSO,
      resultado: RESULTADO_NO_AUTORIZADO,
    });
  });

  it("★ R7 canal conversacional: autoaprobación (vendedorId === empleadoId) ⇒ autoaprobacion_prohibida, fila de auditoría con RESULTADO_AUTOAPROBACION_PROHIBIDA, texto distinguible del rechazo por rol (ADR 216 pto 1)", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", vendedorId: SESION.empleadoId });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_ADMINISTRADOR);
    const registro = makeRegistro();
    const deps = makeDeps({ store, rolPort, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_APROBAR_REEMBOLSO,
      resultado: RESULTADO_AUTOAPROBACION_PROHIBIDA,
      casoId: "caso-venta-1",
      ventaId: "venta-1",
    });
    // Texto literal ADR 216 pto 1 — distinguible del rechazo por rol ("No estás autorizado").
    expect(texto).toBe("No podés aprobar el reembolso de tu propia venta, aunque tengas rol elevado.");
    expect(texto).not.toContain("No estás autorizado");
  });

  it("orden de evaluación (ADR 159, regresión de la tarea 5 alcanzable por el canal conversacional): rol base + venta propia ⇒ no_autorizado, NUNCA autoaprobacion_prohibida", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", vendedorId: SESION.empleadoId });
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => [venta]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const rolPort = makeRolPort(ROL_EMPLEADO);
    const registro = makeRegistro();
    const deps = makeDeps({ store, rolPort, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({ resultado: RESULTADO_NO_AUTORIZADO });
    expect(texto).toContain("No estás autorizado");
  });

  it("listado sin id ⇒ CERO escrituras (regresión, molde resolver_solicitud)", async () => {
    const store = makeVentaStore({ listarReembolsosPendientes: vi.fn(() => []) });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar" }),
      deps,
    );

    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(texto).toContain("No hay escalaciones de reembolso");
  });

  it("confirmado tras eco ⇒ CAS aplica, el dispatcher NO escribe fila del camino feliz (ya la escribe la transacción)", async () => {
    const venta = buildEscalacion({ ventaId: "venta-1", casoId: "caso-venta-1", vendedorId: "otro-empleado" });
    const store = makeVentaStore({
      listarReembolsosPendientes: vi.fn(() => [venta]),
      aprobarEscalacionReembolso: vi.fn(() => buildVenta({ id: "venta-1", estado: VENTA_ESTADO_REEMBOLSADA })),
    });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_REEMBOLSO, accion: "aprobar", ventaId: "venta-1" }, { confirmacion }),
      deps,
    );

    expect(confirmacion.consumir).toHaveBeenCalledTimes(1);
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledTimes(1);
    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(texto).toContain("venta-1");
  });

  it("★ test mecánico ampliado (ADR 207 pto 2, ADR 211, R2): el archivo fuente no compara vendedorId con empleadoId (el dispatcher NUNCA reimplementa el predicado de autoaprobación), no importa 'autorizacion-resolucion', no menciona 'puedeResolverAjeno'", () => {
    const sourcePath = fileURLToPath(new URL("./ejecutar-operacion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/autorizacion-resolucion/);
    expect(source).not.toMatch(/puedeResolverAjeno/);
    expect(source).not.toMatch(/vendedorId\s*===\s*[\w.]*empleadoId/);
    expect(source).not.toMatch(/empleadoId\s*===\s*[\w.]*vendedorId/);
  });
});

/* ── Bloque 4 (ADR 174 pto 2): consultar_reporte_comisiones ── */

describe("ejecutarOperacion — consultar_reporte_comisiones (ADR 174 pto 2, R12)", () => {
  it("periodo ausente ⇒ mes corriente (resolverPeriodoReporte(undefined, ahora))", async () => {
    const reporteStore = makeReporteStore();
    const deps = makeDeps({ reporteStore, now: vi.fn(() => "2026-09-13T00:00:00.000Z") });

    await ejecutarOperacion(makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES }), deps);

    expect(reporteStore.listComisionesPorPeriodo).toHaveBeenCalledWith("2026-09");
  });

  it("periodo inválido ⇒ mensaje de uso, CERO llamadas a reporteStore y CERO a registrarAccion (tarea 16, ADR 188 pto 6)", async () => {
    const reporteStore = makeReporteStore();
    const registro = makeRegistro();
    const deps = makeDeps({ reporteStore, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "no-es-un-periodo" }),
      deps,
    );

    expect(texto).toContain("Periodo inválido");
    expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
    expect(reporteStore.listVentasEnReembolsoPendiente).not.toHaveBeenCalled();
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("periodo válido ⇒ pipeline completo, texto devuelto literal (regresión byte a byte)", async () => {
    const comision: ComisionConVenta = {
      ventaId: "venta-1",
      vendedorId: "vendedor-1",
      vendedorNombre: "Ana",
      comisionMonto: 50,
      ventaMonto: 500,
      ventaEstado: VENTA_ESTADO_CONFIRMADA,
      periodo: "2026-08",
    };
    const reporteStore = makeReporteStore({
      listComisionesPorPeriodo: vi.fn(() => [comision]),
      listVentasEnReembolsoPendiente: vi.fn(() => []),
    });
    const deps = makeDeps({ reporteStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "2026-08" }),
      deps,
    );

    expect(texto).toContain("Reporte de comisiones - periodo 2026-08");
    expect(texto).toContain("Ana");
  });

  it("regresión R12: empleadoId/vendedorId de la sesión NUNCA entran en la llamada a reporteStore (sin filtro)", async () => {
    const reporteStore = makeReporteStore();
    const sesionDistinta: SesionEmpleado = { empleadoId: "empleado-espia", iniciadaEn: AHORA };
    const deps = makeDeps({ reporteStore });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "2026-08" }, { sesion: sesionDistinta }),
      deps,
    );

    expect(reporteStore.listComisionesPorPeriodo).toHaveBeenCalledWith("2026-08");
    expect(vi.mocked(reporteStore.listComisionesPorPeriodo).mock.calls[0]).not.toContain("empleado-espia");
    expect(reporteStore.listVentasEnReembolsoPendiente).toHaveBeenCalledWith();
  });
});

/* ── Bloque 5: resolver_decision_venta / procesar_devolucion / crear_solicitud_interna — paridad con invocadores existentes ── */

describe("ejecutarOperacion — paridad de comportamiento con los invocadores HTTP/TUI existentes", () => {
  it("resolver_decision_venta: confirmar una venta pendiente ⇒ confirmada, con comisión calculada por el núcleo", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION, monto: 1000 });
    const store = makeVentaStore({
      buscarVentaPorToken: vi.fn(() => venta),
      confirmarVentaConComision: vi.fn(() => ({
        venta: { ...venta, estado: VENTA_ESTADO_CONFIRMADA } as Venta,
        comision: { id: "comision-1", ventaId: venta.id, vendedorId: venta.vendedorId, monto: 100, periodo: "2026-09", createdAt: AHORA },
      })),
    });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_DECISION_VENTA, token: "token-1", decision: "confirmar" }),
      deps,
    );

    expect(store.confirmarVentaConComision).toHaveBeenCalledTimes(1);
    expect(texto).toContain("confirmada");
  });

  it("procesar_devolucion: venta confirmada bajo el umbral ⇒ reembolsada automáticamente", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_CONFIRMADA, monto: 100 });
    const store = makeVentaStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => ({ ...venta, estado: VENTA_ESTADO_REEMBOLSADA }) as Venta),
    });
    const deps = makeDeps({ store });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "token-1" }),
      deps,
    );

    expect(store.aprobarReembolso).toHaveBeenCalledTimes(1);
    expect(texto).toContain(venta.id);
  });

  it("crear_solicitud_interna: alta válida delega al validador con material = tipo+detalle exclusivamente", async () => {
    const despacharDeps = makeDespacharDeps();
    const deps = makeDeps({ despacharDeps });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CREAR_SOLICITUD_INTERNA, tipo: SOLICITUD_TIPO_GASTO, detalle: "taxi al cliente" }),
      deps,
    );

    expect(despacharDeps.invocar).toHaveBeenCalledTimes(1);
    const tareaDelegada = vi.mocked(despacharDeps.invocar).mock.calls[0]?.[0].tareaDelegada;
    expect(tareaDelegada).toContain("taxi al cliente");
    expect(tareaDelegada).not.toContain(SESION.empleadoId);
    expect(texto).toContain("creada");
  });
});

/* ── Bloque 6 (ADR 188/RD-87, tarea 16): auditoría de acciones conversacionales en registro_acciones_empleado ── */

describe("ejecutarOperacion — auditoría en registro_acciones_empleado (Enmienda 1, ADR 188/RD-87)", () => {
  it("registrar_venta: UNA llamada con COMANDO_REGISTRAR_VENTA/RESULTADO_CREADA, ventaId/casoId y empleadoId de la sesión", async () => {
    const registro = makeRegistro();
    const sesionDistinta: SesionEmpleado = { empleadoId: "empleado-real", iniciadaEn: AHORA };
    const deps = makeDeps({ registro });

    await ejecutarOperacion(
      makeInput(
        {
          operacion: OPERACION_REGISTRAR_VENTA,
          clienteId: "cliente-1",
          clienteEmail: "cliente@example.com",
          planNuevo: "premium",
          monto: 100,
          vendedorNombre: "Juan Pérez",
        },
        { sesion: sesionDistinta },
      ),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(accion).toMatchObject({
      comando: COMANDO_REGISTRAR_VENTA,
      resultado: RESULTADO_CREADA,
      empleadoId: "empleado-real",
    });
    expect(accion?.ventaId).toBeDefined();
    expect(accion?.casoId).toBeDefined();
  });

  it("resolver_decision_venta: confirmar ⇒ UNA llamada con COMANDO_RESOLVER_DECISION_VENTA/RESULTADO_CONFIRMADA, sin ventaId/casoId (hallazgo 2, R6+ADR 27)", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION, monto: 1000 });
    const store = makeVentaStore({
      buscarVentaPorToken: vi.fn(() => venta),
      confirmarVentaConComision: vi.fn(() => ({
        venta: { ...venta, estado: VENTA_ESTADO_CONFIRMADA } as Venta,
        comision: { id: "comision-1", ventaId: venta.id, vendedorId: venta.vendedorId, monto: 100, periodo: "2026-09", createdAt: AHORA },
      })),
    });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_DECISION_VENTA, token: "token-1", decision: "confirmar" }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(accion).toMatchObject({
      comando: COMANDO_RESOLVER_DECISION_VENTA,
      resultado: RESULTADO_CONFIRMADA,
      empleadoId: SESION.empleadoId,
    });
    expect(accion?.ventaId).toBeUndefined();
    expect(accion?.casoId).toBeUndefined();
  });

  it("resolver_decision_venta: rechazar ⇒ UNA llamada con RESULTADO_RECHAZADA", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION });
    // `rechazarVenta` NO debe devolver `undefined` acá: eso significa "carrera" (no_aplicable) para `resolverDecisionVenta`.
    const store = makeVentaStore({ buscarVentaPorToken: vi.fn(() => venta), rechazarVenta: vi.fn(() => venta) });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_DECISION_VENTA, token: "token-1", decision: "rechazar" }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_RESOLVER_DECISION_VENTA,
      resultado: RESULTADO_RECHAZADA,
    });
  });

  it("resolver_decision_venta: token inexistente ⇒ UNA llamada con RESULTADO_NO_APLICABLE", async () => {
    const store = makeVentaStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_DECISION_VENTA, token: "no-existe", decision: "confirmar" }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_RESOLVER_DECISION_VENTA,
      resultado: RESULTADO_NO_APLICABLE,
    });
  });

  it("procesar_devolucion: reembolsada ⇒ UNA llamada con COMANDO_DEVOLUCION/RESULTADO_REEMBOLSADA, ventaId/casoId de la venta", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_CONFIRMADA, monto: 100 });
    const store = makeVentaStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => ({ ...venta, estado: VENTA_ESTADO_REEMBOLSADA }) as Venta),
    });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    await ejecutarOperacion(makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "token-1" }), deps);

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_DEVOLUCION,
      resultado: RESULTADO_REEMBOLSADA,
      ventaId: venta.id,
      casoId: venta.casoId,
      empleadoId: SESION.empleadoId,
    });
  });

  it("procesar_devolucion: token inexistente (no_aplicable sin venta) ⇒ UNA llamada con RESULTADO_NO_APLICABLE, sin ventaId/casoId", async () => {
    const store = makeVentaStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const registro = makeRegistro();
    const deps = makeDeps({ store, registro });

    await ejecutarOperacion(makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "no-existe" }), deps);

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(accion).toMatchObject({ comando: COMANDO_DEVOLUCION, resultado: RESULTADO_NO_APLICABLE });
    expect(accion?.ventaId).toBeUndefined();
    expect(accion?.casoId).toBeUndefined();
  });

  it("crear_solicitud_interna: alta válida ⇒ UNA llamada con COMANDO_SOLICITAR/RESULTADO_CREADA y el casoId de la solicitud", async () => {
    const registro = makeRegistro();
    const deps = makeDeps({ registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CREAR_SOLICITUD_INTERNA, tipo: SOLICITUD_TIPO_GASTO, detalle: "taxi al cliente" }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(accion).toMatchObject({
      comando: COMANDO_SOLICITAR,
      resultado: RESULTADO_CREADA,
      empleadoId: SESION.empleadoId,
    });
    // El `casoId` lo genera `crearSolicitudInterna` dinámicamente (`newId()`) — se
    // verifica que sea el MISMO que el texto de negocio le devuelve al modelo,
    // no un valor hardcodeado.
    expect(accion?.casoId).toBeDefined();
    expect(texto).toContain(String(accion?.casoId));
  });

  it("crear_solicitud_interna: tipo_desconocido ⇒ CERO llamadas a registrarAccion", async () => {
    const registro = makeRegistro();
    const deps = makeDeps({ registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CREAR_SOLICITUD_INTERNA, tipo: "tipo-inventado", detalle: "x" }),
      deps,
    );

    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("consultar_reporte_comisiones: periodo válido ⇒ UNA llamada con COMANDO_REPORTE_COMISIONES/RESULTADO_ATENDIDA, sin correlación", async () => {
    const reporteStore = makeReporteStore();
    const registro = makeRegistro();
    const deps = makeDeps({ reporteStore, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "2026-08" }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    const accion = vi.mocked(registro.registrarAccion).mock.calls[0]?.[0];
    expect(accion).toMatchObject({ comando: COMANDO_REPORTE_COMISIONES, resultado: RESULTADO_ATENDIDA, empleadoId: SESION.empleadoId });
    expect(accion?.ventaId).toBeUndefined();
    expect(accion?.casoId).toBeUndefined();
  });

  it("cancelar_solicitud_interna: camino feliz ⇒ CERO llamadas a registrarAccion (el store ya audita dentro de su transacción, hallazgo 1)", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1" });
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(texto).toContain("sol-1");
    expect(registro.registrarAccion).not.toHaveBeenCalled();
  });

  it("cancelar_solicitud_interna: camino CAS perdido ⇒ UNA llamada con COMANDO_CANCELAR_SOLICITUD/RESULTADO_NO_APLICABLE", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1" });
    const solicitudStore = makeSolicitudStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      cancelarSolicitud: vi.fn(() => undefined),
    });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CANCELAR_SOLICITUD_INTERNA, solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_CANCELAR_SOLICITUD,
      resultado: RESULTADO_NO_APLICABLE,
      casoId: "caso-solicitud-1",
      empleadoId: SESION.empleadoId,
    });
  });

  it("resolver_solicitud: solicitudId inexistente ⇒ CERO llamadas a registrarAccion, mensaje propio (hallazgo Reviewer 1, molde cancelar_solicitud_interna)", async () => {
    const solicitudStore = makeSolicitudStore({ listarSolicitudesPendientes: vi.fn(() => []) });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => false) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-inexistente" }, { confirmacion }),
      deps,
    );

    expect(registro.registrarAccion).not.toHaveBeenCalled();
    expect(texto).toBe("No hay ninguna solicitud sol-inexistente pendiente de resolución.");
  });

  it("resolver_solicitud: camino CAS perdido ⇒ UNA llamada con COMANDO_APROBAR_SOLICITUD/RESULTADO_NO_APLICABLE (hallazgo Reviewer 1, molde cancelar_solicitud_interna)", async () => {
    const solicitud = buildSolicitud({ id: "sol-1", casoId: "caso-solicitud-1", solicitanteId: "otro-empleado" });
    const solicitudStore = makeSolicitudStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => undefined),
    });
    const confirmacion = makeConfirmacion({ estaConfirmada: vi.fn(() => true) });
    const registro = makeRegistro();
    const deps = makeDeps({ solicitudStore, registro });

    await ejecutarOperacion(
      makeInput({ operacion: OPERACION_RESOLVER_SOLICITUD, accion: "aprobar", solicitudId: "sol-1" }, { confirmacion }),
      deps,
    );

    expect(registro.registrarAccion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registro.registrarAccion).mock.calls[0]?.[0]).toMatchObject({
      comando: COMANDO_APROBAR_SOLICITUD,
      resultado: RESULTADO_NO_APLICABLE,
      casoId: "caso-solicitud-1",
      empleadoId: SESION.empleadoId,
    });
  });

  it("registrarAccion que LANZA: el texto de negocio es idéntico al del camino feliz y se emite accion-empleado-registro-fallido, no el catch global", async () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_CONFIRMADA, monto: 100 });
    const store = makeVentaStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => ({ ...venta, estado: VENTA_ESTADO_REEMBOLSADA }) as Venta),
    });
    const registro = makeRegistro({
      registrarAccion: vi.fn(() => {
        throw new Error("fallo de escritura de auditoría");
      }),
    });
    const logEvent = vi.fn();
    const deps = makeDeps({ store, registro, logEvent });

    const textoConFalloDeRegistro = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "token-1" }),
      deps,
    );

    // Camino feliz de control, mismos deps salvo un `registro` que NO lanza — mismo texto de negocio en los dos casos.
    const depsFeliz = makeDeps({ store, registro: makeRegistro() });
    const textoCaminoFeliz = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_PROCESAR_DEVOLUCION, token: "token-1" }),
      depsFeliz,
    );

    expect(textoConFalloDeRegistro).toBe(textoCaminoFeliz);
    expect(textoConFalloDeRegistro).not.toContain("no se aplicó nada");
    expect(logEvent).toHaveBeenCalledWith(
      CASO_ACTUAL,
      "accion-empleado-registro-fallido",
      expect.objectContaining({ comando: COMANDO_DEVOLUCION, message: "fallo de escritura de auditoría" }),
    );
    expect(logEvent).not.toHaveBeenCalledWith(CASO_ACTUAL, "operacion-fallida", expect.anything());
  });
});
