import { describe, expect, it, vi } from "vitest";
import { MOTIVO_CAS, MOTIVO_NO_ENCONTRADA } from "../hitl/hitl-contract.js";
import {
  SOLICITUD_ESTADO_APROBADA,
  SOLICITUD_ESTADO_CANCELADA,
  SOLICITUD_ESTADO_PENDIENTE,
  SOLICITUD_ESTADO_RECHAZADA,
  SOLICITUD_TIPO_VACACIONES,
  type ResolucionSolicitudInput,
  type SolicitudInterna,
  type SolicitudStorePort,
} from "./solicitudes-contract.js";
import {
  ACCION_APROBAR_SOLICITUD,
  ACCION_CANCELAR_SOLICITUD,
  ACCION_RECHAZAR_SOLICITUD,
  resolverSolicitudInterna,
  type ResolverSolicitudDeps,
} from "./resolver-solicitud-interna.js";
import type { SesionEmpleado } from "../auth/sesion.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "../auth/rol-contract.js";

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

/**
 * Sin default parameter: pasar `undefined` explícito debe significar "ausencia
 * de fila" (ADR 154 pto 5), no disparar un valor por default de JS. Mismo
 * molde que `resolver-escalacion-reembolso.test.ts`.
 */
function makeRolPort(rol: RolEmpleado | undefined): RolEmpleadoPort {
  return { buscarRol: () => rol };
}

/**
 * Default `administrador` (rol elevado): así los fixtures existentes, que no
 * ejercitan el gate de rol ni la autoaprobación, siguen pasando sin tocar
 * cada `it`. Los tests nuevos de la tarea 3.1 pasan un `rolPort` explícito.
 */
function makeDeps(overrides: Partial<ResolverSolicitudDeps> = {}): ResolverSolicitudDeps {
  return {
    store: makeStore(),
    newId: vi.fn(() => "accion-1"),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    rolPort: makeRolPort(ROL_ADMINISTRADOR),
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

  it("confirmado:true (cancelar) → store.cancelarSolicitud, nunca aprobarSolicitud/rechazarSolicitud, evento solicitud-cancelada (R5)", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "ana" });
    const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_CANCELADA });
    const logEvent = vi.fn();
    const store = makeStore({
      listarSolicitudesPendientes: vi.fn(() => [solicitud]),
      cancelarSolicitud: vi.fn(() => resuelta),
    });
    const deps = makeDeps({ store, logEvent });

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_CANCELAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(store.cancelarSolicitud).toHaveBeenCalledTimes(1);
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
    expect(resultado.resultado).toBe("aplicada");
    if (resultado.resultado === "aplicada") {
      expect(resultado.estadoFinal).toBe(SOLICITUD_ESTADO_CANCELADA);
    }
    expect(logEvent).toHaveBeenCalledWith("caso-9", "solicitud-cancelada", {
      solicitudId: "solicitud-1",
      empleadoId: "ana",
    });
  });

  it("cancelar sobre una solicitud ajena → no_es_dueno, sin item, cero llamadas CAS, evento solicitud-cancelacion-no-autorizada (R6)", () => {
    const solicitud = buildSolicitud({ id: "solicitud-1", solicitanteId: "emp-otro" });
    const logEvent = vi.fn();
    const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
    const deps = makeDeps({ store, logEvent });
    const sesionYo: SesionEmpleado = { empleadoId: "emp-yo", iniciadaEn: "2026-09-07T09:00:00.000Z" };

    const resultado = resolverSolicitudInterna(
      { accion: ACCION_CANCELAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: false, sesion: sesionYo },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_es_dueno", accion: ACCION_CANCELAR_SOLICITUD, itemId: "solicitud-1" });
    expect("item" in resultado).toBe(false);
    expect(store.aprobarSolicitud).not.toHaveBeenCalled();
    expect(store.rechazarSolicitud).not.toHaveBeenCalled();
    expect(store.cancelarSolicitud).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith("tui-comando", "solicitud-cancelacion-no-autorizada", {
      accion: ACCION_CANCELAR_SOLICITUD,
      solicitudId: "solicitud-1",
      empleadoId: "emp-yo",
    });
  });

  describe.each([
    ["aprobar", ACCION_APROBAR_SOLICITUD],
    ["rechazar", ACCION_RECHAZAR_SOLICITUD],
  ] as const)(
    "chequeo de dueño gateado por acción (R1): %s sobre solicitud ajena sigue pidiendo confirmación",
    (_nombre, accion) => {
      it("devuelve requiere_confirmacion, NO no_es_dueno", () => {
        const solicitud = buildSolicitud({ id: "solicitud-1", solicitanteId: "emp-otro" });
        const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
        const deps = makeDeps({ store });
        const sesionYo: SesionEmpleado = { empleadoId: "emp-yo", iniciadaEn: "2026-09-07T09:00:00.000Z" };

        const resultado = resolverSolicitudInterna(
          { accion, solicitudId: "solicitud-1", confirmado: false, sesion: sesionYo },
          deps,
        );

        expect(resultado).toEqual({ resultado: "requiere_confirmacion", accion, item: solicitud });
        expect(store.aprobarSolicitud).not.toHaveBeenCalled();
        expect(store.rechazarSolicitud).not.toHaveBeenCalled();
        expect(store.cancelarSolicitud).not.toHaveBeenCalled();
      });
    },
  );

  describe.each([
    ["cancelar", ACCION_CANCELAR_SOLICITUD, true],
    ["aprobar", ACCION_APROBAR_SOLICITUD, false],
    ["rechazar", ACCION_RECHAZAR_SOLICITUD, false],
  ] as const)(
    "listado sin id gateado por acción (R1, ADR 144 pto 2): %s",
    (_nombre, accion, esperaSoloPropias) => {
      it(
        esperaSoloPropias
          ? "llama a store.listarSolicitudesPendientes con { limite, solicitanteId: sesion.empleadoId }"
          : "llama a store.listarSolicitudesPendientes con { limite } EXACTO, sin solicitanteId",
        () => {
          const store = makeStore();
          const deps = makeDeps({ store });

          resolverSolicitudInterna({ accion, confirmado: false, sesion: SESION }, deps);

          if (esperaSoloPropias) {
            expect(store.listarSolicitudesPendientes).toHaveBeenCalledWith({
              limite: 20,
              solicitanteId: SESION.empleadoId,
            });
          } else {
            expect(store.listarSolicitudesPendientes).toHaveBeenCalledWith({ limite: 20 });
          }
        },
      );
    },
  );

  it(
    "ANTI-REGRESIÓN (R8, ADR 144 pto 3): la búsqueda por id de una solicitud ajena NO se filtra por dueño en " +
      "el store — sigue llamando listarSolicitudesPendientes con { solicitudId } SIN solicitanteId, y el " +
      "resultado sigue siendo no_es_dueno, NO no_aplicable/no_encontrada. Este test es el candado explícito " +
      "contra 'unificar' las dos llamadas a listarSolicitudesPendientes (rama A y rama B) por error.",
    () => {
      const solicitud = buildSolicitud({ id: "solicitud-1", solicitanteId: "emp-otro" });
      const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
      const deps = makeDeps({ store });
      const sesionYo: SesionEmpleado = { empleadoId: "emp-yo", iniciadaEn: "2026-09-07T09:00:00.000Z" };

      const resultado = resolverSolicitudInterna(
        { accion: ACCION_CANCELAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: false, sesion: sesionYo },
        deps,
      );

      expect(store.listarSolicitudesPendientes).toHaveBeenCalledWith({ solicitudId: "solicitud-1" });
      expect(store.listarSolicitudesPendientes).not.toHaveBeenCalledWith(
        expect.objectContaining({ solicitanteId: expect.anything() }),
      );
      expect(resultado.resultado).toBe("no_es_dueno");
      expect(resultado.resultado).not.toBe("no_aplicable");
    },
  );

  describe("evento solicitud-listada y soloPropias (ADR 144 pto 5)", () => {
    it("cancelar sin id emite soloPropias: true", () => {
      const logEvent = vi.fn();
      const store = makeStore();
      const deps = makeDeps({ store, logEvent });

      resolverSolicitudInterna({ accion: ACCION_CANCELAR_SOLICITUD, confirmado: false, sesion: SESION }, deps);

      expect(logEvent).toHaveBeenCalledWith("tui-comando", "solicitud-listada", {
        accion: ACCION_CANCELAR_SOLICITUD,
        cantidad: 1,
        soloPropias: true,
      });
    });

    it("aprobar sin id emite el payload EXACTO { accion, cantidad } SIN la clave soloPropias", () => {
      const logEvent = vi.fn();
      const store = makeStore();
      const deps = makeDeps({ store, logEvent });

      resolverSolicitudInterna({ accion: ACCION_APROBAR_SOLICITUD, confirmado: false, sesion: SESION }, deps);

      const llamada = logEvent.mock.calls.find(([, evento]) => evento === "solicitud-listada");
      expect(llamada?.[2]).toEqual({ accion: ACCION_APROBAR_SOLICITUD, cantidad: 1 });
      expect(llamada?.[2]).not.toHaveProperty("soloPropias");
    });
  });

  describe("gate de rol y prohibición de autoaprobación (autorizacion-empleado, ADR 153/155/159, tarea 3.1)", () => {
    describe.each([
      ["aprobar", ACCION_APROBAR_SOLICITUD],
      ["rechazar", ACCION_RECHAZAR_SOLICITUD],
    ] as const)("rol base + %s de una solicitud ajena", (_nombre, accion) => {
      it("→ no_autorizado, sin tocar el store, evento solicitud-resolucion-no-autorizada", () => {
        const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "empleado-x" });
        const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
        const logEvent = vi.fn();
        const deps = makeDeps({ store, logEvent, rolPort: makeRolPort(ROL_EMPLEADO) });

        const resultado = resolverSolicitudInterna(
          { accion, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
          deps,
        );

        expect(resultado).toEqual({
          resultado: "no_autorizado",
          accion,
          itemId: "solicitud-1",
          casoId: "caso-9",
        });
        expect(store.aprobarSolicitud).not.toHaveBeenCalled();
        expect(store.rechazarSolicitud).not.toHaveBeenCalled();
        expect(logEvent).toHaveBeenCalledWith("caso-9", "solicitud-resolucion-no-autorizada", {
          accion,
          solicitudId: "solicitud-1",
          empleadoId: "ana",
        });
      });
    });

    describe.each([
      ["aprobar", ACCION_APROBAR_SOLICITUD],
      ["rechazar", ACCION_RECHAZAR_SOLICITUD],
    ] as const)("rol elevado + %s de la propia solicitud", (_nombre, accion) => {
      it("→ autoaprobacion_prohibida, el rol NO alcanza para salvarla (ADR 155)", () => {
        const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "ana" });
        const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
        const logEvent = vi.fn();
        const deps = makeDeps({ store, logEvent, rolPort: makeRolPort(ROL_ADMINISTRADOR) });

        const resultado = resolverSolicitudInterna(
          { accion, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
          deps,
        );

        expect(resultado).toEqual({
          resultado: "autoaprobacion_prohibida",
          accion,
          itemId: "solicitud-1",
          casoId: "caso-9",
        });
        expect(store.aprobarSolicitud).not.toHaveBeenCalled();
        expect(store.rechazarSolicitud).not.toHaveBeenCalled();
        expect(logEvent).toHaveBeenCalledWith("caso-9", "solicitud-autoaprobacion-rechazada", {
          accion,
          solicitudId: "solicitud-1",
          empleadoId: "ana",
        });
      });
    });

    it("rol base + cancelar la propia solicitud → sigue aplicando igual, el gate nuevo no la toca (esAccionAutoservicio la desvía antes)", () => {
      const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "ana" });
      const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_CANCELADA });
      const store = makeStore({
        listarSolicitudesPendientes: vi.fn(() => [solicitud]),
        cancelarSolicitud: vi.fn(() => resuelta),
      });
      const deps = makeDeps({ store, rolPort: makeRolPort(ROL_EMPLEADO) });

      const resultado = resolverSolicitudInterna(
        { accion: ACCION_CANCELAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
        deps,
      );

      expect(store.cancelarSolicitud).toHaveBeenCalledTimes(1);
      expect(resultado.resultado).toBe("aplicada");
    });

    it("rol elevado + acción sobre solicitud ajena → aplica igual que antes del change (regresión explícita)", () => {
      const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "empleado-x" });
      const resuelta = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", estado: SOLICITUD_ESTADO_APROBADA });
      const store = makeStore({
        listarSolicitudesPendientes: vi.fn(() => [solicitud]),
        aprobarSolicitud: vi.fn(() => resuelta),
      });
      const deps = makeDeps({ store, rolPort: makeRolPort(ROL_ADMINISTRADOR) });

      const resultado = resolverSolicitudInterna(
        { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
        deps,
      );

      expect(store.aprobarSolicitud).toHaveBeenCalledTimes(1);
      expect(resultado.resultado).toBe("aplicada");
    });

    it("orden de precedencia (RD-78): rol base Y solicitud propia coinciden en aprobar → no_autorizado, la autoaprobación nunca se llega a evaluar", () => {
      const solicitud = buildSolicitud({ id: "solicitud-1", casoId: "caso-9", solicitanteId: "ana" });
      const store = makeStore({ listarSolicitudesPendientes: vi.fn(() => [solicitud]) });
      const deps = makeDeps({ store, rolPort: makeRolPort(ROL_EMPLEADO) });

      const resultado = resolverSolicitudInterna(
        { accion: ACCION_APROBAR_SOLICITUD, solicitudId: "solicitud-1", confirmado: true, sesion: SESION },
        deps,
      );

      expect(resultado).toEqual({
        resultado: "no_autorizado",
        accion: ACCION_APROBAR_SOLICITUD,
        itemId: "solicitud-1",
        casoId: "caso-9",
      });
    });
  });
});
