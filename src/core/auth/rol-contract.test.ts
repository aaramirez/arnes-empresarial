import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ROLES_EMPLEADO,
  ROL_ADMINISTRADOR,
  ROL_EMPLEADO,
  type RolEmpleado,
  type RolEmpleadoEscritorPort,
  type RolEmpleadoPort,
} from "./rol-contract.js";

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

/**
 * `comandos-administracion-empleados`, ADR 180/RD-82 — escritor co-ubicado
 * con `RolEmpleadoPort` (lectura, arriba, SIN TOCAR). Test de forma, molde
 * EXACTO del describe `RolEmpleadoPort` de arriba: la verificación de que el
 * adaptador por defecto llama a `upsertRolEmpleado` con los tres campos
 * exactos, contra un `db` real de SQLite en memoria, vive en
 * `build-on-comando-empleado.test.ts` (`createRolEmpleadoEscritor`) — este
 * módulo sigue "sin imports" (ver describe de abajo) y no puede importar
 * `better-sqlite3` ni `repository.ts` para probarlo acá.
 */
describe("RolEmpleadoEscritorPort", () => {
  it("es satisfecho por un objeto con asignarRol(input): void", () => {
    const llamadas: Array<{ empleadoId: string; rol: RolEmpleado; ahora: string }> = [];
    const port: RolEmpleadoEscritorPort = {
      asignarRol(input) {
        llamadas.push(input);
      },
    };

    const resultado = port.asignarRol({ empleadoId: "ana", rol: ROL_ADMINISTRADOR, ahora: "2026-01-01T00:00:00.000Z" });

    expect(resultado).toBeUndefined();
    expect(llamadas).toEqual([{ empleadoId: "ana", rol: ROL_ADMINISTRADOR, ahora: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("rol-contract.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./rol-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
