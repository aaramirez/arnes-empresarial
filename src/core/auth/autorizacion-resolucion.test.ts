import { describe, expect, it } from "vitest";
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleadoPort } from "./rol-contract.js";
import { esAdministrador, puedeResolverAjeno } from "./autorizacion-resolucion.js";

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

/**
 * `comandos-administracion-empleados`, ADR 183 parte 2/RD-84 — nombre
 * DISTINTO de `puedeResolverAjeno` a propósito: hoy coinciden en
 * implementación (dos roles), pero responden preguntas de política
 * distintas. Test rojo inicial de todo el change (Approach punto 1 de
 * `proposal.md`): un empleado con rol base no alcanza para lo que este
 * módulo va a gatear en el dispatcher.
 */
describe("esAdministrador", () => {
  it("rol administrador explícito ⇒ true", () => {
    expect(esAdministrador(makePort(ROL_ADMINISTRADOR), "ana")).toBe(true);
  });

  it("rol empleado explícito ⇒ false", () => {
    expect(esAdministrador(makePort(ROL_EMPLEADO), "ana")).toBe(false);
  });

  it("puerto devuelve undefined (ausencia de fila) ⇒ false, NUNCA autoriza", () => {
    expect(esAdministrador(makePort(undefined), "ana")).toBe(false);
  });
});
