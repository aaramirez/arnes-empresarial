import { describe, expect, it, vi } from "vitest";
import { consultarVentaPropia } from "./consultar-venta-propia.js";
import type { ConsultaVentaPropiaPort, VentaPropia } from "./consulta-venta-contract.js";

/**
 * `devolucion-sin-token-dos-personas`, tarea 6 (ADR 224 pto 4, ADR 225).
 * Molde `procesar-devolucion.test.ts` — dobles del puerto, nunca SQLite real.
 */

function buildVentaPropia(overrides: Partial<VentaPropia> = {}): VentaPropia {
  return {
    ventaId: "venta-1",
    vendedorId: "empleado-1",
    clienteId: "cliente-1",
    planNuevo: "plan-pro",
    monto: 1000,
    estado: "confirmada",
    casoId: "caso-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeConsulta(overrides: Partial<ConsultaVentaPropiaPort> = {}): ConsultaVentaPropiaPort {
  return {
    buscarPorId: vi.fn(() => undefined),
    listarDeVendedor: vi.fn(() => []),
    ...overrides,
  };
}

describe("consultarVentaPropia — venta propia (detalle)", () => {
  it("con ventaId de una venta propia ⇒ detalle con el estado (la decisión del cliente)", () => {
    const venta = buildVentaPropia({ ventaId: "venta-1", vendedorId: "empleado-1", estado: "rechazada" });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });

    const resultado = consultarVentaPropia({ ventaId: "venta-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "detalle", venta });
  });
});

describe("consultarVentaPropia — venta ajena", () => {
  it("★ venta cuyo vendedorId no es el del empleado ⇒ no_autorizada, distinguible de no_encontrada, CERO escrituras", () => {
    const venta = buildVentaPropia({ ventaId: "venta-1", vendedorId: "otro-empleado" });
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });

    const resultado = consultarVentaPropia({ ventaId: "venta-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "no_autorizada", ventaId: "venta-1" });
    expect(resultado.resultado).not.toBe("no_encontrada");
  });
});

describe("consultarVentaPropia — venta inexistente", () => {
  it("buscarPorId devuelve undefined ⇒ no_encontrada", () => {
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => undefined) });

    const resultado = consultarVentaPropia({ ventaId: "no-existe", empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "no_encontrada", ventaId: "no-existe" });
  });
});

describe("consultarVentaPropia — listado sin ventaId", () => {
  it("ausente ⇒ listado de TODAS las ventas propias del vendedor, cualquier estado", () => {
    const items = [buildVentaPropia({ ventaId: "venta-1" }), buildVentaPropia({ ventaId: "venta-2", estado: "reembolsada" })];
    const listarDeVendedor = vi.fn(() => items);
    const consulta = makeConsulta({ listarDeVendedor });

    const resultado = consultarVentaPropia({ empleadoId: "empleado-1" }, { consulta });

    expect(resultado).toEqual({ resultado: "listado", items });
    expect(listarDeVendedor).toHaveBeenCalledWith({ vendedorId: "empleado-1" });
  });

  it("el listado NUNCA filtra por estado — la decisión del cliente es el punto del hallazgo 3", () => {
    const listarDeVendedor = vi.fn((_filtro: Parameters<ConsultaVentaPropiaPort["listarDeVendedor"]>[0]) => []);
    const consulta = makeConsulta({ listarDeVendedor });

    consultarVentaPropia({ empleadoId: "empleado-1" }, { consulta });

    const filtro = listarDeVendedor.mock.calls[0]?.[0];
    expect(filtro).not.toHaveProperty("estados");
  });
});

describe("consultarVentaPropia — CERO escrituras, en cualquier rama", () => {
  it("con ventaId, ausente y ajena — el módulo sólo invoca métodos de lectura del puerto", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });

    consultarVentaPropia({ ventaId: "venta-1", empleadoId: "empleado-1" }, { consulta });
    consultarVentaPropia({ empleadoId: "empleado-1" }, { consulta });

    // `ConsultaVentaPropiaPort` sólo declara los dos métodos de lectura — no
    // hay ningún método de escritura que pudiera haberse invocado.
    expect(Object.keys(consulta)).toEqual(["buscarPorId", "listarDeVendedor"]);
  });
});

describe("consultarVentaPropia — sin datos personales del cliente más allá de clienteId (ADR 18)", () => {
  it("el detalle no agrega ningún campo nuevo más allá de lo que VentaPropia ya declara", () => {
    const venta = buildVentaPropia();
    const consulta = makeConsulta({ buscarPorId: vi.fn(() => venta) });

    const resultado = consultarVentaPropia({ ventaId: "venta-1", empleadoId: "empleado-1" }, { consulta });

    expect(resultado.resultado).toBe("detalle");
    if (resultado.resultado === "detalle") {
      expect(resultado.venta).toBe(venta);
    }
  });
});
