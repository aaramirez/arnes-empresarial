import { describe, expect, it, vi } from "vitest";
import { MOTIVO_CAS, MOTIVO_NO_ENCONTRADA } from "../hitl/hitl-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_TIPO_VACACIONES,
  type ResolucionSolicitudInput,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./solicitudes-contract.js";
import {
  ACCION_APROBAR_SOLICITUD,
  ACCION_RECHAZAR_SOLICITUD,
  resolverSolicitudInterna,
  type ResolverSolicitudDeps,
} from "./resolver-solicitud-interna.js";
import type { SesionEmpleado } from "../auth/sesion.js";

/**
 * Spec `solicitud-interna-hitl` (ADR 37, 50). Dobles planos de
 * `SolicitudStorePort` — nunca SQLite real, mismo criterio que
 * `resolver-escalacion-reembolso.test.ts` (Hito 5, tarea 18).
 */

const AHORA = "2026-09-07T10:00:00.000Z";
const SESION: SesionEmpleado = { empleadoId: "ana", iniciadaEn: "2026-09-07T09:00:00.000Z" };

function buildSolicitud(overrides: Partial<SolicitudInterna> = {}): SolicitudInterna {
  return {
    id: "solicitud-1",
    casoId: "caso-1",
    solicitanteId: "empleado-x",
    tipo: SOLICITUD_TIPO_VACACIONES,
    detalle: "una semana en marzo",
    estado: SOLICITUD_ESTADO_PENDIENTE,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(overrides: Partial<SolicitudStorePort> = {}): SolicitudStorePort {
  return {
    crearSolicitudConCaso: vi.fn(),
    adjuntarDictamen: vi.fn(),
    listarSolicitudesPendientes: vi.fn(() => [buildSolicitud()]),
    aprobarSolicitud: vi.fn(() => undefined),
    rechazarSolicitud: vi.fn(() => undefined),
    cancelarSolicitud: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ResolverSolicitudDeps> = {}): ResolverSolicitudDeps {
  return {
    store: makeStore(),
    newId: vi.fn(() => "accion-1"),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("resolverSolicitudInterna", () => {
  it("sin solicitudId → listado con listarSolicitudesPendientes, CERO escrituras", () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado.resultado).toBe("listado");
    expect(store.listarSolicitudesPendientes).toHaveBeenCalledWith({ limite: 20 });
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("sin solicitudId respeta limiteListado explícito", () => {
    const store = makeStore();
    const deps = makeDeps({ store, limiteListado: 5 });

    resolverSolicitudInterna({ accion: ACCION_APROBAR_SOLICITUD, confirmado: false, sesion: SESION }, deps);

    expect(store.listarSolicitudesPendientes).toHaveBeenCalledWith({ limite: 5 });
  });

  it("solicitudId inexistente → no_aplicable/no_encontrada, sin escrituras", () => {
    const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => []) });
    const deps = makeDeps({ store });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-x", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APROBAR_SOLICITUD,
      motivo: MOTIVO_NO_ENCONTRADA,
      itemId: "solicitud-x",
    });
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("confirmado:false con solicitudId presente → requiere_confirmacion (eco), CERO escrituras", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1" });
    const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const deps = makeDeps({ store });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "requiere_confirmacion",
      accion: ACCION_APROBAR_SOLICITUD,
      item: solicitud,
    });
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("confirmado:true (aprobar) → store.aprobarSolicitud con {solicitudId, casoId, empleadoId, accionId, ahora} exactos", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9" });
    const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_APROBADA });
    const store = makeStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => resuelta),
    });
    const deps = makeDeps({ store, newId: vi.fn(() => "accion-77"), now: vi.fn(() => AHORA) });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
      deps,
    );

    const inputEsperado: ResolucionSolicitudInput = {
      solicitudId: "solicitud-1",
      casoId: "caso-9",
      empleadoId: "ana",
      accionId: "accion-77",
      ahora: AHORA,
    };
    expect(store.aprobarSolicitud).toHaveBeenCalledWith(inputEsperado);
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      resultado: "aplicada",
      accion: ACCION_APROBAR_SOLICITUD,
      item: solicitud,
      estadoFinal: SOLICITUD_ESTADO_APROBADA,
    });
  });

  it("confirmado:true (rechazar) → store.rechazarSolicitud", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9" });
    const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_RECHAZADA });
    const store = makeStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      rechazarSolicitud: vi.fn(() => resuelta),
    });
    const deps = makeDeps({ store });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_RECHAZAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(store.rechazarSolicitud).toHaveBeenCalled();
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(resultado.resultado).toBe("aplicada");
    if (resultado.resultado === "aplicada") {
      expect(resultado.estadoFinal).toBe(SOLICITUD_ESTADO_RECHAZADA);
    }
  });

  it("CAS devuelve undefined → no_aplicable/cas, sin lanzar", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-1" });
    const store = makeStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof resolverSolicitudInterna> | undefined;
    expect(() => {
      resultado = resolverSolicitudInterna(
        { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
        deps,
      );
    }).not.toThrow();

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APROBAR_SOLICITUD,
      motivo: MOTIVO_CAS,
      itemId: "solicitud-1",
      casoId: "caso-1",
    });
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable", () => {
    const deps = makeDeps();

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });

  it("logEvent registra solicitud-listada / solicitud-resolucion-solicitada / solicitud-aprobada con los campos del diseño", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9" });
    const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_APROBADA });
    const logEvent = vi.fn();

    const storeListado = makeStore();
    resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, confirmado: false, sesion: SESION },
      makeDeps({ store: storeListado, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("tui-comando", "solicitud-listada", {
      accion: ACCION_APROBAR_SOLICITUD,
      cantidad: 1,
    });

    logEvent.mockClear();
    const storeEco = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: false, sesion: SESION },
      makeDeps({ store: storeEco, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("caso-9", "solicitud-resolucion-solicitada", {
      accion: ACCION_APROBAR_SOLICITUD,
      solicitudId: "solicitud-1",
    });

    logEvent.mockClear();
    const storeAplicada = makeStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      aprobarSolicitud: vi.fn(() => resuelta),
    });
    resolverSolicitudInterna(
      { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
      makeDeps({ store: storeAplicada, logEvent }),
    );
    expect(logEvent).toHaveBeenCalledWith("caso-9", "solicitud-aprobada", {
      solicitudId: "solicitud-1",
      empleadoId: "ana",
    });
  });
});
