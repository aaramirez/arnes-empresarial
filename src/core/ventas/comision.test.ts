import { describe, expect, it } from "vitest";
import { calcularComision, periodoDeConfirmacion } from "./comision.js";

describe("calcularComision", () => {
  it("1000 × 0.1 = 100 exacto — no 100.00000000000001", () => {
    expect(calcularComision(1000, 0.1)).toBe(100);
  });

  it("redondea el .005 hacia arriba — 0.05 × 0.1 = 0.01", () => {
    expect(calcularComision(0.05, 0.1)).toBe(0.01);
  });

  it("redondea correctamente un monto con 3+ decimales de entrada", () => {
    // 123.456 * 0.1 = 12.345600000000001 en IEEE-754 → redondea a 12.35
    expect(calcularComision(123.456, 0.1)).toBe(12.35);
  });

  it("porcentaje = 1 → la comisión es igual al monto", () => {
    expect(calcularComision(1000, 1)).toBe(1000);
    expect(calcularComision(0.1, 1)).toBe(0.1);
  });
});

describe("periodoDeConfirmacion", () => {
  it("devuelve 'YYYY-MM' a partir de un ISO-8601 UTC", () => {
    expect(periodoDeConfirmacion("2024-02-15T10:30:00.000Z")).toBe("2024-02");
  });

  it("caso borde: 31/01 22:00 UTC sigue siendo enero — no se desliza a febrero por zona horaria", () => {
    // Con getMonth()/zona local, 22:00 UTC del 31 de enero podría caer en
    // 1 de febrero según el huso horario de la máquina que corre el
    // proceso. periodoDeConfirmacion usa slice(0, 7) sobre el ISO en UTC,
    // así que el resultado NUNCA depende de dónde corre el proceso.
    expect(periodoDeConfirmacion("2024-01-31T22:00:00.000Z")).toBe("2024-01");
  });

  it("no usa Date/getMonth de forma que dependa de la zona horaria local — slice puro sobre el string", () => {
    expect(periodoDeConfirmacion("2023-12-31T23:59:59.999Z")).toBe("2023-12");
  });
});
