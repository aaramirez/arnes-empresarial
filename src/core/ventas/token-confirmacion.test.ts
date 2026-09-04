import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VENTA_ESTADO_CONFIRMADA,
  VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  VENTA_ESTADO_RECHAZADA,
  VENTA_ESTADO_REEMBOLSADA,
  VENTA_ESTADO_REEMBOLSO_PENDIENTE,
  VENTA_ESTADOS,
  type Venta,
  type VentaEstado,
} from "./ventas-contract.js";
import {
  MOTIVO_TOKEN_ESTADO_INVALIDO,
  MOTIVO_TOKEN_INEXISTENTE,
  MOTIVO_TOKEN_VENCIDO,
  calcularExpiresAt,
  validarTokenConfirmacion,
} from "./token-confirmacion.js";

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

const AHORA = "2026-01-05T12:00:00.000Z";

describe("validarTokenConfirmacion", () => {
  it("venta undefined (token inexistente) → inexistente", () => {
    const result = validarTokenConfirmacion(undefined, AHORA);

    expect(result).toEqual({ valido: false, motivo: MOTIVO_TOKEN_INEXISTENTE });
  });

  const otrosEstados = VENTA_ESTADOS.filter(
    (estado) => estado !== VENTA_ESTADO_PENDIENTE_CONFIRMACION,
  ) as readonly VentaEstado[];

  it.each(otrosEstados.map((estado) => [estado] as const))(
    "estado %s (≠ pendiente_confirmacion) → estado_invalido",
    (estado) => {
      const venta = buildVenta({ estado });

      const result = validarTokenConfirmacion(venta, AHORA);

      expect(result).toEqual({ valido: false, motivo: MOTIVO_TOKEN_ESTADO_INVALIDO });
    },
  );

  it("cubre los 4 estados distintos de pendiente_confirmacion (guarda contra listas incompletas)", () => {
    expect(otrosEstados).toEqual([
      VENTA_ESTADO_CONFIRMADA,
      VENTA_ESTADO_RECHAZADA,
      VENTA_ESTADO_REEMBOLSADA,
      VENTA_ESTADO_REEMBOLSO_PENDIENTE,
    ]);
  });

  it("expiresAt en el pasado → vencido", () => {
    const venta = buildVenta({ expiresAt: "2026-01-05T11:59:59.999Z" });

    const result = validarTokenConfirmacion(venta, AHORA);

    expect(result).toEqual({ valido: false, motivo: MOTIVO_TOKEN_VENCIDO });
  });

  it("expiresAt === ahora exacto → vencido (el vencimiento es inclusivo, no exclusivo)", () => {
    const venta = buildVenta({ expiresAt: AHORA });

    const result = validarTokenConfirmacion(venta, AHORA);

    expect(result).toEqual({ valido: false, motivo: MOTIVO_TOKEN_VENCIDO });
  });

  it("expiresAt en el futuro → válido", () => {
    const venta = buildVenta({ expiresAt: "2026-01-05T12:00:00.001Z" });

    const result = validarTokenConfirmacion(venta, AHORA);

    expect(result).toEqual({ valido: true, venta });
  });

  it("expiresAt ausente (TTL=0, sin vencimiento) → válido", () => {
    const venta = buildVenta();

    const result = validarTokenConfirmacion(venta, AHORA);

    expect(result).toEqual({ valido: true, venta });
  });
});

describe("calcularExpiresAt", () => {
  it("ttlHoras 0 → undefined (sin vencimiento)", () => {
    expect(calcularExpiresAt("2026-01-01T00:00:00.000Z", 0)).toBeUndefined();
  });

  it("ttlHoras 72 → suma exactamente 72 horas, ISO-8601 UTC", () => {
    expect(calcularExpiresAt("2026-01-01T00:00:00.000Z", 72)).toBe("2026-01-04T00:00:00.000Z");
  });
});

describe("token-confirmacion.ts source", () => {
  it("no llama a Date.now() — ahora siempre llega inyectado por parámetro", () => {
    const sourcePath = fileURLToPath(new URL("./token-confirmacion.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");
    // Descarta comentarios de bloque y de línea antes de inspeccionar código
    // real: la documentación del módulo cita `Date.now()` a propósito para
    // explicar por qué NO se usa (mismo criterio que ventas-config.test.ts).
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(codeOnly).not.toMatch(/Date\.now\(/);
  });
});
