import { describe, expect, it, vi } from "vitest";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADO_RECHAZADA,
  type Venta,
  type VentaEstado,
  type VentaStorePort,
} from "./ventas-contract.js";
import { procesarDevolucion, type ProcesarDevolucionDeps } from "./procesar-devolucion.js";

/**
 * Spec `reembolso-evaluacion`, requirements "Devolución requiere una venta
 * confirmada" y "Evaluación no llama al modelo" (ADR 19). Dobles planos de
 * `VentaStorePort` — nunca SQLite real, mismo criterio que
 * `confirmar-venta.test.ts`.
 */

const AHORA = "2026-02-15T10:00:00.000Z";

function withEstado(venta: Venta, estado: VentaEstado): Venta {
  return { ...venta, estado };
}

function buildVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: "venta-1",
    vendedorId: "vendedor-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 100,
    estado: VENTA_ESTADO_CONFIRMADA,
    casoId: "caso-1",
    tokenConfirmacion: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(overrides: Partial<VentaStorePort> = {}): VentaStorePort {
  return {
    crearVentaConCaso: vi.fn(),
    buscarVentaPorToken: vi.fn(() => buildVenta()),
    confirmarVentaConComision: vi.fn(() => undefined),
    rechazarVenta: vi.fn(() => undefined),
    aprobarReembolso: vi.fn(() => undefined),
    escalarReembolso: vi.fn(() => undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ProcesarDevolucionDeps> = {}): ProcesarDevolucionDeps {
  return {
    store: makeStore(),
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72 },
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("procesarDevolucion", () => {
  it("venta inexistente → no_aplicable", () => {
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const deps = makeDeps({ store });

    const resultado = procesarDevolucion({ token: "token-x" }, deps);

    expect(resultado).toEqual({ resultado: "no_aplicable" });
    expect(store.aprobarReembolso).not.toHaveBeenCalled();
    expect(store.escalarReembolso).not.toHaveBeenCalled();
  });

  it.each<VentaEstado>([
    VENTA_ESTADO_PENDIENTE_CONFIRMACION,
    VENTA_ESTADO_RECHAZADA,
    VENTA_ESTADO_REEMBOLSADA,
    VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  ])("venta en estado '%s' (≠ confirmada) → no_aplicable, sin efecto", (estado) => {
    const venta = buildVenta({ estado });
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => venta) });
    const deps = makeDeps({ store });

    const resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);

    expect(resultado).toEqual({ resultado: "no_aplicable" });
    expect(store.aprobarReembolso).not.toHaveBeenCalled();
    expect(store.escalarReembolso).not.toHaveBeenCalled();
  });

  it("monto bajo el umbral → store.aprobarReembolso, resultado reembolsada", () => {
    const venta = buildVenta({ monto: 100 });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => withEstado(venta, VENTA_ESTADO_REEMBOLSADA)),
    });
    const deps = makeDeps({ store, config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72 } });

    const resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);

    expect(resultado).toEqual({ resultado: "reembolsada" });
    expect(store.aprobarReembolso).toHaveBeenCalledWith({ ventaId: venta.id, ahora: AHORA });
    expect(store.escalarReembolso).not.toHaveBeenCalled();
  });

  it("monto igual al umbral → store.escalarReembolso con el casoId de la venta, resultado escalada", () => {
    const venta = buildVenta({ monto: 500, casoId: "caso-9" });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      escalarReembolso: vi.fn(() => withEstado(venta, VENTA_ESTADO_REEMBOLSO_PENDIENTE)),
    });
    const deps = makeDeps({ store, config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72 } });

    const resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);

    expect(resultado).toEqual({ resultado: "escalada" });
    expect(store.escalarReembolso).toHaveBeenCalledWith({
      ventaId: venta.id,
      casoId: "caso-9",
      ahora: AHORA,
    });
    expect(store.aprobarReembolso).not.toHaveBeenCalled();
  });

  it("monto sobre el umbral → store.escalarReembolso, resultado escalada", () => {
    const venta = buildVenta({ monto: 1000, casoId: "caso-9" });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      escalarReembolso: vi.fn(() => withEstado(venta, VENTA_ESTADO_REEMBOLSO_PENDIENTE)),
    });
    const deps = makeDeps({ store, config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72 } });

    const resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);

    expect(resultado).toEqual({ resultado: "escalada" });
    expect(store.escalarReembolso).toHaveBeenCalledWith({
      ventaId: venta.id,
      casoId: "caso-9",
      ahora: AHORA,
    });
  });

  it("store.aprobarReembolso devuelve undefined (carrera CAS) → no_aplicable, sin lanzar excepción", () => {
    const venta = buildVenta({ monto: 100 });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof procesarDevolucion> | undefined;
    expect(() => {
      resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);
    }).not.toThrow();

    expect(resultado).toEqual({ resultado: "no_aplicable" });
  });

  it("store.escalarReembolso devuelve undefined (carrera CAS) → no_aplicable, sin lanzar excepción", () => {
    const venta = buildVenta({ monto: 1000 });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      escalarReembolso: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof procesarDevolucion> | undefined;
    expect(() => {
      resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);
    }).not.toThrow();

    expect(resultado).toEqual({ resultado: "no_aplicable" });
  });

  it("ningún camino de este archivo llama a store.confirmarVentaConComision ni store.rechazarVenta (nada de comisiones)", () => {
    const ventaBajoUmbral = buildVenta({ monto: 100 });
    const storeBajo = makeStore({
      buscarVentaPorToken: vi.fn(() => ventaBajoUmbral),
      aprobarReembolso: vi.fn(() => withEstado(ventaBajoUmbral, VENTA_ESTADO_REEMBOLSADA)),
    });
    procesarDevolucion({ token: ventaBajoUmbral.tokenConfirmacion }, makeDeps({ store: storeBajo }));
    expect(storeBajo.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(storeBajo.rechazarVenta).not.toHaveBeenCalled();

    const ventaSobreUmbral = buildVenta({ monto: 1000 });
    const storeSobre = makeStore({
      buscarVentaPorToken: vi.fn(() => ventaSobreUmbral),
      escalarReembolso: vi.fn(() => withEstado(ventaSobreUmbral, VENTA_ESTADO_REEMBOLSO_PENDIENTE)),
    });
    procesarDevolucion({ token: ventaSobreUmbral.tokenConfirmacion }, makeDeps({ store: storeSobre }));
    expect(storeSobre.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(storeSobre.rechazarVenta).not.toHaveBeenCalled();
  });

  it("expires_at vencido NO bloquea la devolución (ADR 19, punto 2) — venta confirmada con token vencido igual se procesa", () => {
    const venta = buildVenta({
      monto: 100,
      // Vencido MUY en el pasado respecto de `AHORA` — si el módulo pasara
      // por `validarTokenConfirmacion`, esto devolvería `vencido`.
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => withEstado(venta, VENTA_ESTADO_REEMBOLSADA)),
    });
    const deps = makeDeps({ store });

    const resultado = procesarDevolucion({ token: venta.tokenConfirmacion }, deps);

    expect(resultado).toEqual({ resultado: "reembolsada" });
    expect(store.aprobarReembolso).toHaveBeenCalledWith({ ventaId: venta.id, ahora: AHORA });
  });

  it("motivo opcional se acepta sin alterar el resultado", () => {
    const venta = buildVenta({ monto: 100 });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      aprobarReembolso: vi.fn(() => withEstado(venta, VENTA_ESTADO_REEMBOLSADA)),
    });
    const deps = makeDeps({ store });

    const resultado = procesarDevolucion(
      { token: venta.tokenConfirmacion, motivo: "no le gustó el plan" },
      deps,
    );

    expect(resultado).toEqual({ resultado: "reembolsada" });
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable", () => {
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const deps = makeDeps({ store });

    const resultado = procesarDevolucion({ token: "token-x" }, deps);

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });
});
