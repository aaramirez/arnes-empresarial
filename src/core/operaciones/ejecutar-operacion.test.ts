import { describe, expect, it, vi } from "vitest";
import {
  OPERACION_CANCELAR_SOLICITUD_INTERNA,
  OPERACION_CONSULTAR_REPORTE_COMISIONES,
  OPERACION_CREAR_SOLICITUD_INTERNA,
  OPERACION_PROCESAR_DEVOLUCION,
  OPERACION_REGISTRAR_VENTA,
  OPERACION_RESOLVER_DECISION_VENTA,
  type ConfirmacionOperacionPort,
  type OperacionNegocio,
} from "./operaciones-contract.js";
import { ejecutarOperacion, type EjecutarOperacionDeps } from "./ejecutar-operacion.js";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_REEMBOLSADA,
  type CrearVentaConCasoInput,
  type NotificacionResultado,
  type Venta,
  type VentaNotifierPort,
  type VentaStorePort,
} from "../ventas/ventas-contract.js";
import {
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
import { ROL_ADMINISTRADOR, type RolEmpleado, type RolEmpleadoPort } from "../auth/rol-contract.js";
import type { SesionEmpleado } from "../auth/sesion.js";

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

    expect(confirmacion.estaConfirmada).toHaveBeenCalledWith("sol-1", SESION.empleadoId, CASO_ACTUAL);
    expect(confirmacion.marcarPendiente).toHaveBeenCalledWith(
      expect.objectContaining({
        solicitudId: "sol-1",
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
    expect(solicitudStore.cancelarSolicitud).toHaveBeenCalledTimes(1);
    expect(texto).toContain("sol-1");
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

  it("periodo inválido ⇒ mensaje de uso, CERO llamadas a reporteStore", async () => {
    const reporteStore = makeReporteStore();
    const deps = makeDeps({ reporteStore });

    const texto = await ejecutarOperacion(
      makeInput({ operacion: OPERACION_CONSULTAR_REPORTE_COMISIONES, periodo: "no-es-un-periodo" }),
      deps,
    );

    expect(texto).toContain("Periodo inválido");
    expect(reporteStore.listComisionesPorPeriodo).not.toHaveBeenCalled();
    expect(reporteStore.listVentasEnReembolsoPendiente).not.toHaveBeenCalled();
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
