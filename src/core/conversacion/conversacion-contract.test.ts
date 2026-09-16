import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConversacionEmpleadoPort } from "./conversacion-contract.js";

/**
 * chat-web-empleado, tarea 1. Molde de `operaciones-contract.test.ts` /
 * `rol-contract.test.ts`: constantes + chequeos de tipos en compilación,
 * más el test de fuente "sin imports".
 */

describe("ConversacionEmpleadoPort (ADR 196 pto 4)", () => {
  it("es satisfecho por un objeto con casoAnterior(), registrarTurno(casoId) y conversacionId()", () => {
    let ultimoCasoId: string | undefined;
    const conversacionId = "conv-1";

    const port: ConversacionEmpleadoPort = {
      casoAnterior: () => ultimoCasoId,
      registrarTurno: (casoId) => {
        ultimoCasoId = casoId;
      },
      conversacionId: () => conversacionId,
    };

    expect(port.casoAnterior()).toBeUndefined();
    expect(port.conversacionId()).toBe("conv-1");

    port.registrarTurno("caso-A");

    expect(port.casoAnterior()).toBe("caso-A");
    expect(port.registrarTurno("caso-B")).toBeUndefined();
    expect(port.casoAnterior()).toBe("caso-B");
  });
});

describe("conversacion-contract.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./conversacion-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
