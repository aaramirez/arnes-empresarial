import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CredencialEmpleado, type CredencialesEmpleadoPort } from "./credenciales-contract.js";

/** Spec `autenticacion-empleado-tui`, ADR 30. */

describe("CredencialesEmpleadoPort", () => {
  it("es satisfecho por un objeto con buscarCredencial(empleadoId): CredencialEmpleado | undefined", () => {
    const credencial: CredencialEmpleado = {
      empleadoId: "ana",
      passwordHash: "scrypt$16384$8$1$c2FsdA==$Y2xhdmU=",
    };
    const port: CredencialesEmpleadoPort = {
      buscarCredencial(empleadoId) {
        return empleadoId === "ana" ? credencial : undefined;
      },
    };

    expect(port.buscarCredencial("ana")).toEqual(credencial);
    expect(port.buscarCredencial("inexistente")).toBeUndefined();
  });
});

describe("credenciales-contract.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./credenciales-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });

  /**
   * `comandos-administracion-empleados`, tarea 9 — "grep de contrato": el
   * comentario histórico de `:14-17` (*"la TUI no puede crear
   * credenciales, y eso es una propiedad del diseño, no un olvido"*) dejó
   * de ser cierto (tarea 8, `/crear-empleado`). Este test blinda que el
   * comentario ACTUALIZADO apunte al ADR que lo cambió (ADR 174) y que la
   * afirmación vieja ya no esté presente sin matices.
   */
  it("el comentario de la interfaz apunta a ADR 174 (comandos-administracion-empleados, tarea 9) — no queda la afirmación vieja sin matices", () => {
    const sourcePath = fileURLToPath(new URL("./credenciales-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).toContain("ADR 174");
    expect(source).not.toContain("la TUI no puede crear credenciales, y eso es una propiedad del diseño, no un olvido");
  });
});
