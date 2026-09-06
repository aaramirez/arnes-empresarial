import { describe, expect, it } from "vitest";
import { parseArgsEmpleado } from "./empleados.js";

/**
 * Spec `autenticacion-empleado-tui`, requirements "Alta de credencial por
 * CLI con contraseña por stdin" y "Rotación de credencial por CLI" (ADR 33).
 * Solo se testea `parseArgsEmpleado` — el resto es I/O, verificado
 * manualmente (mismo criterio que `reporte-mensual.test.ts` con
 * `parsePeriodo`).
 */

describe("parseArgsEmpleado", () => {
  it("['ana'] → alta", () => {
    expect(parseArgsEmpleado(["ana"])).toEqual({ ok: true, empleadoId: "ana", modo: "alta" });
  });

  it("['ana','--rotar'] → rotar", () => {
    expect(parseArgsEmpleado(["ana", "--rotar"])).toEqual({ ok: true, empleadoId: "ana", modo: "rotar" });
  });

  it("['--rotar','ana'] → rotar (orden libre)", () => {
    expect(parseArgsEmpleado(["--rotar", "ana"])).toEqual({ ok: true, empleadoId: "ana", modo: "rotar" });
  });

  it("[] → uso (empleadoId ausente)", () => {
    const resultado = parseArgsEmpleado([]);
    expect(resultado.ok).toBe(false);
  });

  it("['--rotar'] → uso (empleadoId ausente, solo la flag)", () => {
    const resultado = parseArgsEmpleado(["--rotar"]);
    expect(resultado.ok).toBe(false);
  });

  it("['ana bad'] → uso (un solo argv con espacio no matchea ID_REGEX)", () => {
    const resultado = parseArgsEmpleado(["ana bad"]);
    expect(resultado.ok).toBe(false);
  });

  it("['--ana'] → uso (todo son flags, ningún posicional)", () => {
    const resultado = parseArgsEmpleado(["--ana"]);
    expect(resultado.ok).toBe(false);
  });

  it("['ana','--rotr'] → uso (flag desconocida, NO cae en silencio al modo alta)", () => {
    const resultado = parseArgsEmpleado(["ana", "--rotr"]);
    expect(resultado.ok).toBe(false);
  });

  it("un empleadoId con caracteres inválidos (espacio, símbolo) → uso", () => {
    expect(parseArgsEmpleado(["ana!"]).ok).toBe(false);
  });

  it("acepta un empleadoId con puntos, guiones y guion bajo", () => {
    expect(parseArgsEmpleado(["ana.beto-3_x"])).toEqual({
      ok: true,
      empleadoId: "ana.beto-3_x",
      modo: "alta",
    });
  });
});
