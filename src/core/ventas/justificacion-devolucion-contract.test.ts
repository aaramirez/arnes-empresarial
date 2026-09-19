import { describe, expect, it, vi } from "vitest";
import { MOTIVO_MAX_LENGTH, type JustificacionDevolucionPort } from "./justificacion-devolucion-contract.js";

/**
 * `devolucion-sin-token-dos-personas`, tarea 8 (ADR 228 pto 5-6, RD-106).
 * Molde `consulta-venta-contract.test.ts`: constantes + un doble que compila
 * con la firma exacta del puerto — este archivo no tiene comportamiento
 * propio que testear todavía (eso es `solicitar-devolucion.ts`, tarea 14).
 */

describe("MOTIVO_MAX_LENGTH", () => {
  it("es 256, mismo valor que MAX_STRING_LENGTH de validar-operacion.ts (ADR 228 pto 5, duplicado a propósito)", () => {
    expect(MOTIVO_MAX_LENGTH).toBe(256);
  });
});

describe("JustificacionDevolucionPort — un doble compila con la ÚNICA operación del puerto (APPEND-ONLY, R13)", () => {
  it("registrar es la única superficie — sin update, sin delete, sin búsqueda por motivo", () => {
    const filas: Array<{
      readonly id: string;
      readonly ventaId: string;
      readonly casoId: string;
      readonly solicitanteId: string;
      readonly motivo: string;
      readonly solicitadaAt: string;
    }> = [];

    const port: JustificacionDevolucionPort = {
      registrar: vi.fn((input) => {
        filas.push(input);
      }),
    };

    port.registrar({
      id: "just-1",
      ventaId: "venta-1",
      casoId: "caso-1",
      solicitanteId: "empleado-1",
      motivo: "el cliente se arrepintió",
      solicitadaAt: "2026-09-17T00:00:00.000Z",
    });

    expect(filas).toHaveLength(1);
    // La interfaz sólo declara `registrar` — no hay ningún otro método que
    // pudiera exponer update/delete/búsqueda.
    expect(Object.keys(port)).toEqual(["registrar"]);
  });
});
