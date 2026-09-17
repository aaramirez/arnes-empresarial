import { describe, expect, it } from "vitest";
import {
  LIMITE_LISTADO_VENTAS_PROPIAS,
  type ConsultaVentaPropiaPort,
  type VentaPropia,
} from "./consulta-venta-contract.js";

/**
 * `devolucion-sin-token-dos-personas`, tarea 1 (ADR 225, ADR 227). ★ Riesgo
 * más alto del change (R1 de `proposal.md`): ninguna clave de `VentaPropia`
 * puede contener la subcadena `token` — es el rojo inicial #1 del change,
 * inexpresable antes de que este tipo exista.
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

describe("VentaPropia — invariante negativo del token (ADR 225 pto 3, ADR 227 pto 5)", () => {
  it("★ ninguna clave del objeto contiene la subcadena 'token', ni siquiera con todos los campos opcionales presentes", () => {
    const venta = buildVentaPropia({
      planAnterior: "plan-basico",
      confirmedAt: "2026-09-02T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
    });

    const claves = Object.keys(venta);

    expect(claves.length).toBeGreaterThan(0);
    for (const clave of claves) {
      expect(clave.toLowerCase()).not.toContain("token");
    }
  });

  it("LIMITE_LISTADO_VENTAS_PROPIAS es 20, mismo valor que LIMITE_LISTADO_ESCALACIONES (ADR 208 pto 5, patrón por dominio)", () => {
    expect(LIMITE_LISTADO_VENTAS_PROPIAS).toBe(20);
  });
});

describe("ConsultaVentaPropiaPort — un doble compila con las dos firmas exactas", () => {
  it("buscarPorId y listarDeVendedor, sin ningún método de escritura en la interfaz", () => {
    const ventas = new Map<string, VentaPropia>([["venta-1", buildVentaPropia()]]);

    const port: ConsultaVentaPropiaPort = {
      buscarPorId: (ventaId) => ventas.get(ventaId),
      listarDeVendedor: ({ vendedorId, estados, limite }) => {
        const todas = [...ventas.values()].filter((v) => v.vendedorId === vendedorId);
        const filtradas = estados === undefined ? todas : todas.filter((v) => estados.includes(v.estado));
        return filtradas.slice(0, limite ?? LIMITE_LISTADO_VENTAS_PROPIAS);
      },
    };

    expect(port.buscarPorId("venta-1")?.ventaId).toBe("venta-1");
    expect(port.buscarPorId("no-existe")).toBeUndefined();
    expect(port.listarDeVendedor({ vendedorId: "empleado-1" })).toHaveLength(1);
    expect(port.listarDeVendedor({ vendedorId: "otro" })).toHaveLength(0);
  });
});
