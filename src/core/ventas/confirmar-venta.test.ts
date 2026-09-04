import { describe, expect, it, vi } from "vitest";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_RECHAZADA,
  type Comision,
  type ConfirmarVentaConComisionInput,
  type Venta,
  type VentaStorePort,
} from "./ventas-contract.js";
import { MOTIVO_TOKEN_INEXISTENTE, MOTIVO_TOKEN_VENCIDO } from "./token-confirmacion.js";
import {
  DECISION_CONFIRMAR,
  DECISION_RECHAZAR,
  resolverDecisionVenta,
  type ConfirmarVentaDeps,
} from "./confirmar-venta.js";

/**
 * Spec `venta-confirmacion`, requirements 4-5 (escenarios "Rechazo no genera
 * comisión", "Reintento sobre token ya procesado"). Dobles planos de
 * `VentaStorePort` — nunca SQLite real, mismo criterio que
 * `registrar-venta.test.ts` y `token-confirmacion.test.ts`.
 */

const AHORA = "2026-02-15T10:00:00.000Z";

function buildVenta(overrides: Partial<Venta> = {}): Venta {
  return {
    id: "venta-1",
    vendedorId: "vendedor-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 1000,
    estado: VENTA_ESTADO_PENDIENTE_CONFIRMACION,
    casoId: "caso-1",
    tokenConfirmacion: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
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

function makeDeps(overrides: Partial<ConfirmarVentaDeps> = {}): ConfirmarVentaDeps {
  let contadorId = 0;
  return {
    store: makeStore(),
    config: { comisionPorcentaje: 0.1, reembolsoUmbral: 500, tokenTtlHoras: 72 },
    newId: vi.fn(() => `comision-${++contadorId}`),
    now: vi.fn(() => AHORA),
    logEvent: vi.fn(),
    ...overrides,
  };
}

describe("resolverDecisionVenta", () => {
  it("token inexistente → no_aplicable, el store NUNCA recibe un write", () => {
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => undefined) });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: "token-x", decision: DECISION_CONFIRMAR },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_aplicable", motivo: MOTIVO_TOKEN_INEXISTENTE });
    expect(store.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(store.rechazarVenta).not.toHaveBeenCalled();
  });

  it("token vencido → no_aplicable, el store NUNCA recibe un write", () => {
    const venta = buildVenta({ expiresAt: "2026-02-15T09:00:00.000Z" });
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => venta) });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: venta.tokenConfirmacion, decision: DECISION_CONFIRMAR },
      deps,
    );

    expect(resultado).toEqual({ resultado: "no_aplicable", motivo: MOTIVO_TOKEN_VENCIDO });
    expect(store.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(store.rechazarVenta).not.toHaveBeenCalled();
  });

  it("token con estado inválido (ya procesado) → no_aplicable, sin write nuevo", () => {
    const venta = buildVenta({ estado: VENTA_ESTADO_CONFIRMADA, confirmedAt: AHORA });
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => venta) });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: venta.tokenConfirmacion, decision: DECISION_RECHAZAR },
      deps,
    );

    expect(resultado.resultado).toBe("no_aplicable");
    expect(store.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(store.rechazarVenta).not.toHaveBeenCalled();
  });

  it("confirmar sobre token válido produce una comisión con el monto y período esperados", () => {
    const venta = buildVenta({ monto: 1000 });
    const comisionEsperada: Comision = {
      id: "comision-1",
      ventaId: venta.id,
      vendedorId: venta.vendedorId,
      monto: 100,
      periodo: "2026-02",
      createdAt: AHORA,
    };
    const ventaConfirmada: Venta = {
      ...venta,
      estado: VENTA_ESTADO_CONFIRMADA,
      confirmedAt: AHORA,
    };
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      confirmarVentaConComision: vi.fn(() => ({
        venta: ventaConfirmada,
        comision: comisionEsperada,
      })),
    });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: venta.tokenConfirmacion, decision: DECISION_CONFIRMAR },
      deps,
    );

    expect(resultado).toEqual({ resultado: "confirmada", comisionMonto: 100, periodo: "2026-02" });
    expect(store.confirmarVentaConComision).toHaveBeenCalledWith(
      expect.objectContaining({
        ventaId: venta.id,
        comisionMonto: 100,
        periodo: "2026-02",
        ahora: AHORA,
      }),
    );
  });

  it("rechazar → confirmarVentaConComision NUNCA se llama, solo rechazarVenta, sin comisión", () => {
    const venta = buildVenta();
    const ventaRechazada: Venta = { ...venta, estado: VENTA_ESTADO_RECHAZADA };
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      rechazarVenta: vi.fn(() => ventaRechazada),
    });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: venta.tokenConfirmacion, decision: DECISION_RECHAZAR },
      deps,
    );

    expect(resultado).toEqual({ resultado: "rechazada" });
    expect(store.confirmarVentaConComision).not.toHaveBeenCalled();
    expect(store.rechazarVenta).toHaveBeenCalledWith({ ventaId: venta.id, ahora: AHORA });
  });

  it("store.confirmarVentaConComision devuelve undefined (carrera CAS) → no_aplicable, sin lanzar excepción", () => {
    const venta = buildVenta();
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      confirmarVentaConComision: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof resolverDecisionVenta> | undefined;
    expect(() => {
      resultado = resolverDecisionVenta(
        { token: venta.tokenConfirmacion, decision: DECISION_CONFIRMAR },
        deps,
      );
    }).not.toThrow();

    expect(resultado).toEqual({ resultado: "no_aplicable", motivo: "carrera" });
  });

  it("store.rechazarVenta devuelve undefined (carrera CAS) → no_aplicable, sin lanzar excepción", () => {
    const venta = buildVenta();
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      rechazarVenta: vi.fn(() => undefined),
    });
    const deps = makeDeps({ store });

    let resultado: ReturnType<typeof resolverDecisionVenta> | undefined;
    expect(() => {
      resultado = resolverDecisionVenta(
        { token: venta.tokenConfirmacion, decision: DECISION_RECHAZAR },
        deps,
      );
    }).not.toThrow();

    expect(resultado).toEqual({ resultado: "no_aplicable", motivo: "carrera" });
  });

  it("el mismo `ahora` inyectado llega a la validación, a confirmarVentaConComision.ahora y al período — un único reloj", () => {
    const nowFn = vi.fn(() => AHORA);
    // expiresAt en el futuro relativo a AHORA, para que la validación pase.
    const venta = buildVenta({ expiresAt: "2026-02-15T10:00:00.001Z" });
    const store = makeStore({
      buscarVentaPorToken: vi.fn(() => venta),
      confirmarVentaConComision: vi.fn((input: ConfirmarVentaConComisionInput) => {
        const ventaConfirmada: Venta = {
          ...venta,
          estado: VENTA_ESTADO_CONFIRMADA,
          confirmedAt: input.ahora,
        };
        const comision: Comision = {
          id: input.comisionId,
          ventaId: venta.id,
          vendedorId: venta.vendedorId,
          monto: input.comisionMonto,
          periodo: input.periodo,
          createdAt: input.ahora,
        };
        return { venta: ventaConfirmada, comision };
      }),
    });
    const deps = makeDeps({ store, now: nowFn });

    resolverDecisionVenta({ token: venta.tokenConfirmacion, decision: DECISION_CONFIRMAR }, deps);

    // now() se llama UNA sola vez: el mismo valor viaja a la validación del
    // token, a `ahora` del store y al período — no dos relojes distintos.
    expect(nowFn).toHaveBeenCalledTimes(1);
    const inputPasado = vi.mocked(store.confirmarVentaConComision).mock.calls[0]?.[0];
    expect(inputPasado?.ahora).toBe(AHORA);
    expect(inputPasado?.periodo).toBe(AHORA.slice(0, 7));
  });

  it("es SÍNCRONA: no devuelve una Promise ni un objeto thenable", () => {
    const venta = buildVenta();
    const store = makeStore({ buscarVentaPorToken: vi.fn(() => venta) });
    const deps = makeDeps({ store });

    const resultado = resolverDecisionVenta(
      { token: venta.tokenConfirmacion, decision: DECISION_RECHAZAR },
      deps,
    );

    expect(resultado).not.toBeInstanceOf(Promise);
    expect(typeof (resultado as { then?: unknown }).then).not.toBe("function");
  });
});
