/**
 * Test mecánico (`modo-headless-cierre-limpio`, tarea 1.4, E1) sobre el
 * FUENTE de los tres composition roots que abren la base
 * (`main.ts`, `empleados.ts` ×2, `reporte-mensual.ts`): ninguno usa ya el
 * literal `openDatabase("data/harness.db")`, todos abren por
 * `resolveDbPath()` (RD-122). Por NOMBRE, sin números de línea — sobrevive
 * a que otro change mueva las líneas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function contar(texto: string, aguja: string): number {
  return texto.split(aguja).length - 1;
}

function leerFuente(archivo: string): string {
  return readFileSync(new URL(archivo, import.meta.url), "utf8");
}

describe("los cuatro call sites de openDatabase abren la base por resolveDbPath() (modo-headless-cierre-limpio, tarea 1.4, E1)", () => {
  it("main.ts: cero literales openDatabase(\"data/harness.db\"), un resolveDbPath()", () => {
    const source = leerFuente("./main.ts");
    expect(contar(source, 'openDatabase("data/harness.db")')).toBe(0);
    expect(contar(source, "resolveDbPath()")).toBe(1);
  });

  it("empleados.ts: cero literales, dos resolveDbPath() (asignar-rol y alta/rotar contraseña)", () => {
    const source = leerFuente("./empleados.ts");
    expect(contar(source, 'openDatabase("data/harness.db")')).toBe(0);
    expect(contar(source, "resolveDbPath()")).toBe(2);
  });

  it("reporte-mensual.ts: cero literales, un resolveDbPath()", () => {
    const source = leerFuente("./reporte-mensual.ts");
    expect(contar(source, 'openDatabase("data/harness.db")')).toBe(0);
    expect(contar(source, "resolveDbPath()")).toBe(1);
  });
});
