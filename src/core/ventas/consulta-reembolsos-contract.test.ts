import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EscalacionListada } from "./ventas-contract.js";
import type { ConsultaReembolsosPort } from "./consulta-reembolsos-contract.js";

const ESCALACION_SIMULADA: EscalacionListada = {
  ventaId: "venta-1",
  vendedorId: "vendedor-1",
  vendedorNombre: "Ana Vendedora",
  clienteId: "cliente-1",
  monto: 1000,
  casoId: "caso-1",
  reaperturasPrevias: 0,
};

describe("ConsultaReembolsosPort", () => {
  it("un doble que implementa el puerto compila contra la interfaz y listPendientes devuelve EscalacionListada[]", () => {
    const port: ConsultaReembolsosPort = {
      listPendientes() {
        return [ESCALACION_SIMULADA];
      },
    };

    expect(port.listPendientes()).toEqual([ESCALACION_SIMULADA]);
  });

  it("la firma de listPendientes NO acepta ningún parámetro — aridad 0 (cerrado sobre reembolso_pendiente desde el composition root, ADR 182 pto 4)", () => {
    const port: ConsultaReembolsosPort = {
      listPendientes() {
        return [];
      },
    };

    expect(port.listPendientes.length).toBe(0);
  });

  it("devuelve lista vacía cuando no hay escalaciones pendientes", () => {
    const port: ConsultaReembolsosPort = {
      listPendientes() {
        return [];
      },
    };

    expect(port.listPendientes()).toEqual([]);
  });
});

describe("consulta-reembolsos-contract.ts source", () => {
  it("no importa nada salvo ventas-contract.js — el puerto no acepta un estado arbitrario", () => {
    const sourcePath = fileURLToPath(new URL("./consulta-reembolsos-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    const importLines = source.match(/^import .*/gm) ?? [];

    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/\.\/ventas-contract\.js/);
    expect(source).not.toMatch(/estado\s*:\s*string/);
  });
});
