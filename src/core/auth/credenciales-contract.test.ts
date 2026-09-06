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
});
