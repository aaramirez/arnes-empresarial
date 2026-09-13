import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES_EMPLEADO, ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleado, type RolEmpleadoPort } from "./rol-contract.js";

/** Spec `autorizacion-empleado`, ADR 157/162. */

describe("ROLES_EMPLEADO", () => {
  it("tiene exactamente 2 miembros: empleado (base) y administrador (elevado)", () => {
    expect(ROLES_EMPLEADO).toHaveLength(2);
    expect(ROLES_EMPLEADO).toEqual([ROL_EMPLEADO, ROL_ADMINISTRADOR]);
  });
});

describe("RolEmpleadoPort", () => {
  it("es satisfecho por un objeto con buscarRol(empleadoId): RolEmpleado | undefined", () => {
    const port: RolEmpleadoPort = {
      buscarRol(empleadoId) {
        const rol: RolEmpleado = "administrador";
        return empleadoId === "ana" ? rol : undefined;
      },
    };

    expect(port.buscarRol("ana")).toBe("administrador");
    expect(port.buscarRol("inexistente")).toBeUndefined();
  });
});

describe("rol-contract.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./rol-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
