import { describe, expect, it, vi } from "vitest";
import {
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_REEMBOLSO_RECHAZADO,
  type EscalacionListada,
  type ResolucionEscalacionInput,
  type Venta,
  type VentaStorePort,
} from "./ventas-contract.js";
import {
  ACCION_APROBAR,
  ACCION_REABRIR,
  ACCION_RECHAZAR,
  resolverEscalacionReembolso,
  type ResolverEscalacionDeps,
} from "./resolver-escalacion-reembolso.js";
import type { SesionEmpleado } from "../auth/sesion.js";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "../auth/rol-contract.js";

/**
 * Spec `reembolso-resolucion-escalacion` (ADR 25, 29, 37, 38). Dobles planos
 * de `VentaStorePort` — nunca SQLite real, mismo criterio que
 * `procesar-devolucion.test.ts`.
 */

const AHORA = "2026-09-01T10:00:00.000Z";
const SESION: SesionEmpleado = { empleadoId: "ana", iniciadaEn: "2026-09-01T09:00:00.000Z" };

function buildEscalacion(overrides: Partial<EscalacionListada> = {}): EscalacionListada {
  return {
    ventaId: "venta-1",
    vendedorId: "vendedor-1",
    vendedorNombre: "Ana Vendedora",
    clienteId: "cliente-1",
    monto: 1000,
    casoId: "caso-1",
    reaperturasPrevias: 0,
    ...overrides,
  };
}

function buildVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: "venta-1",
    vendedorId: "vendedor-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 1000,
    estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE,
    casoId: "caso-1",
    tokenConfirmacion: "token-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  return {
    crearVentaConCaso: vi.fn(),
    buscarVentaPorToken: vi.fn(),
    confirmarVentaConComision: vi.fn(),
    rechazarVenta: vi.fn(),
    aprobarReembolso: vi.fn(),
    escalarReembolso: vi.fn(),
    listarReembolsosPendientes: vi.fn(() => [buildEscalacion()]),
    listarReembolsosRechazados: vi.fn(() => [buildEscalacion()]),
    aprobarEscalacionReembolso: vi.fn(() => undefined),
    rechazarEscalacionReembolso: vi.fn(() => undefined),
    reabrirEscalacionReembolso: vi.fn(() => undefined),
    ...overrides,
  };
}

/**
 * Default `administrador` (rol elevado): así los fixtures existentes, que no
 * ejercitan el gate de rol, siguen pasando sin tocar cada `it`. Los tests
 * nuevos del gate (rol base) pasan un `rolPort` explícito por override.
 */
/**
 * Sin default parameter: pasar `undefined` explícito debe significar "ausencia
 * de fila" (ADR 154 pto 5), no disparar un valor por default de JS.
 */
function makeRolPort(rol: RolEmpleado | undefined): RolEmpleadoPort {
  return { buscarRol: () => rol };
}

function makeDeps(overrides: Partial<ResolverEscalacionDeps> = {}): ResolverEscalacionDeps {
  return {
    store: makeStore(),
    newId: vi.fn(() => "accion-1"),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    rolPort: makeRolPort(ROL_ADMINISTRADOR),
    ...overrides,
  };
}

describe("resolverEscalacionReembolso", () => {
  it("sin ventaId (aprobar) → listado con listarReembolsosPendientes, CERO escrituras", () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado.resultado).toBe("listado");
    expect(store.listarReembolsosPendientes).toHaveBeenCalled();
    expect(store.listarReembolsosRechazados).not.toHaveBeenCalled();
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.reabrirEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("sin ventaId (reabrir) → listado con listarReembolsosRechazados, NUNCA listarReembolsosPendientes", () => {
    const store = makeStore();
    const deps = makeDeps({ store });

    resolverEscalacionReembolso({ accion: ACCION_REABRIR, confirmado: false, sesion: SESION }, deps);

    expect(store.listarReembolsosRechazados).toHaveBeenCalled();
    expect(store.listarReembolsosPendientes).not.toHaveBeenCalled();
  });

  it("ventaId inexistente → no_aplicable/no_encontrada, sin escrituras", () => {
    const store = makeStore({ listarReembolsosPendientes: vi.fn(() => []) });
    const deps = makeDeps({ store });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, ventaId: "venta-x", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APROBAR,
      motivo: "no_encontrada",
      ventaId: "venta-x",
    });
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("confirmado:false con ventaId presente → requiere_confirmacion, CERO escrituras en store ni registro", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", monto: 750 });
    const store = makeStore({ listarReembolsosPendientes: vi.fn(() => [escalacion]) });
    const deps = makeDeps({ store });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "requiere_confirmacion",
      accion: ACCION_APROBAR,
      venta: escalacion,
    });
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.reabrirEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("confirmado:true (aprobar) → store.aprobarEscalacionReembolso con {ventaId, casoId, empleadoId, accionId, ahora} exactos", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const venta = buildVenta({ estado: VENTA_ESTADO_REEMBOLSADA });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [escalacion]),
      aprobarEscalacionReembolso: vi.fn(() => venta),
    });
    const deps = makeDeps({ store, newId: vi.fn(() => "accion-77"), now: vi.fn(() => AHORA) });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    const inputEsperado: ResolucionEscalacionInput = {
      ventaId: "venta-1",
      casoId: "caso-9",
      empleadoId: "ana",
      accionId: "accion-77",
      ahora: AHORA,
    };
    expect(store.aprobarEscalacionReembolso).toHaveBeenCalledWith(inputEsperado);
    expect(resultado).toEqual({
      resultado: "aplicada",
      accion: ACCION_APROBAR,
      venta: escalacion,
      estadoFinal: VENTA_ESTADO_REEMBOLSADA,
    });
  });

  it("confirmado:true (rechazar) → store.rechazarEscalacionReembolso", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const venta = buildVenta({ estado: VENTA_ESTADO_REEMBOLSO_RECHAZADO });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [escalacion]),
      rechazarEscalacionReembolso: vi.fn(() => venta),
    });
    const deps = makeDeps({ store });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_RECHAZAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(store.rechazarEscalacionReembolso).toHaveBeenCalled();
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(resultado.resultado).toBe("aplicada");
  });

  it("confirmado:true (reabrir) → store.reabrirEscalacionReembolso, buscando en listarReembolsosRechazados", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const venta = buildVenta({ estado: VENTA_ESTADO_REEMBOLSO_PENDIENTE });
    const store = makeStore({
      listarReembolsosRechazados: vi.fn(() => [escalacion]),
      reabrirEscalacionReembolso: vi.fn(() => venta),
    });
    const deps = makeDeps({ store });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_REABRIR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(store.listarReembolsosRechazados).toHaveBeenCalledWith({ ventaId: "venta-1" });
    expect(store.reabrirEscalacionReembolso).toHaveBeenCalled();
    expect(resultado.resultado).toBe("aplicada");
  });

  it("CAS devuelve undefined → no_aplicable/cas, sin lanzar", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1" });
    const store = makeStore({
      listarReembolsosPendientes: vi.fn(() => [escalacion]),
      aprobarEscalacionReembolso: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof resolverEscalacionReembolso> | undefined;
    expect(() => {
      resultado = resolverEscalacionReembolso(
        { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
        deps,
      );
    }).not.toThrow();

    expect(resultado).toEqual({
      resultado: "no_aplicable",
      accion: ACCION_APROBAR,
      motivo: "cas",
      ventaId: "venta-1",
      casoId: "caso-1",
    });
  });

  it("rol base + confirmado:true (aprobar) → no_autorizado, sin tocar store.aprobarEscalacionReembolso", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const store = makeStore({ listarReembolsosPendientes: vi.fn(() => [escalacion]) });
    const deps = makeDeps({ store, rolPort: makeRolPort(ROL_EMPLEADO) });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_autorizado",
      accion: ACCION_APROBAR,
      ventaId: "venta-1",
      casoId: "caso-9",
    });
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
    expect(store.reabrirEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("rol base + confirmado:true (rechazar) → no_autorizado, sin tocar store.rechazarEscalacionReembolso", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const store = makeStore({ listarReembolsosPendientes: vi.fn(() => [escalacion]) });
    const deps = makeDeps({ store, rolPort: makeRolPort(ROL_EMPLEADO) });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_RECHAZAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_autorizado",
      accion: ACCION_RECHAZAR,
      ventaId: "venta-1",
      casoId: "caso-9",
    });
    expect(store.rechazarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("rol base + confirmado:true (reabrir) → no_autorizado, sin tocar store.reabrirEscalacionReembolso", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const store = makeStore({ listarReembolsosRechazados: vi.fn(() => [escalacion]) });
    const deps = makeDeps({ store, rolPort: makeRolPort(ROL_EMPLEADO) });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_REABRIR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado).toEqual({
      resultado: "no_autorizado",
      accion: ACCION_REABRIR,
      ventaId: "venta-1",
      casoId: "caso-9",
    });
    expect(store.reabrirEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("rol base sin fila (undefined) + confirmado:true → no_autorizado (ADR 154 pto 5, ausencia nunca autoriza)", () => {
    const escalacion = buildEscalacion({ ventaId: "venta-1", casoId: "caso-9" });
    const store = makeStore({ listarReembolsosPendientes: vi.fn(() => [escalacion]) });
    const deps = makeDeps({ store, rolPort: makeRolPort(undefined) });

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, ventaId: "venta-1", confirmado: true, sesion: SESION },
      deps,
    );

    expect(resultado.resultado).toBe("no_autorizado");
    expect(store.aprobarEscalacionReembolso).not.toHaveBeenCalled();
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable", () => {
    const deps = makeDeps();

    const resultado = resolverEscalacionReembolso(
      { accion: ACCION_APROBAR, confirmado: false, sesion: SESION },
      deps,
    );

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });
});
