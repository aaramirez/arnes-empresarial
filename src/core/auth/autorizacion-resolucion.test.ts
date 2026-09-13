import { describe, expect, it } from "vitest";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleadoPort } from "./rol-contract.js";
import { puedeResolverAjeno } from "./autorizacion-resolucion.js";

/**
 * Spec `autorizacion-empleado` req. "Un `empleado_id` sin fila de rol cae al
 * rol base, nunca al elevado" (ADR 154 pto 5). Único test que prueba el
 * invariante de ausencia — los dos call sites (`resolver-escalacion-reembolso.ts`,
 * `resolver-solicitud-interna.ts`) confían en este módulo, no reimplementan.
 */

function makePort(rol: ReturnType<RolEmpleadoPort["buscarRol"]>): RolEmpleadoPort {
  return { buscarRol: () => rol };
}

describe("puedeResolverAjeno", () => {
  it("rol administrador explícito ⇒ true", () => {
    expect(puedeResolverAjeno(makePort(ROL_ADMINISTRADOR), "ana")).toBe(true);
  });

  it("rol empleado explícito ⇒ false", () => {
    expect(puedeResolverAjeno(makePort(ROL_EMPLEADO), "ana")).toBe(false);
  });

  it("puerto devuelve undefined (ausencia de fila) ⇒ false, NUNCA autoriza", () => {
    expect(puedeResolverAjeno(makePort(undefined), "ana")).toBe(false);
  });
});
