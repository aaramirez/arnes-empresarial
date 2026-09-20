/**
 * Marco delimitado de texto externo (ADR 241, visibilidad-a2a-entrante-chat,
 * tarea 2.1). Test-first: exige forma, orden y el rótulo como constante
 * exportada — ver design.md §4.2, §8, §13.2 (test 5b, D2).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MARCA_EXTERNO_INICIO,
  MARCA_EXTERNO_FIN,
  MAX_CHARS_TEXTO_EXTERNO_MODELO,
  ROTULO_EXTERNO_NO_CONFIABLE,
  enmarcarTextoExterno,
} from "./texto-externo.js";

describe("texto-externo (visibilidad-a2a-entrante-chat, tarea 2.1)", () => {
  it("constantes: marcas y tope fijos", () => {
    expect(MARCA_EXTERNO_INICIO).toBe("<<<EXTERNO:INICIO>>>");
    expect(MARCA_EXTERNO_FIN).toBe("<<<EXTERNO:FIN>>>");
    expect(MAX_CHARS_TEXTO_EXTERNO_MODELO).toBe(1000);
  });

  it("forma: rótulo + marca de inicio + contenido + marca de fin, en ese orden, cada marca en su propia línea", () => {
    const salida = enmarcarTextoExterno("mensaje recibido", "hola");
    const lineas = salida.split("\n");

    expect(salida.indexOf(ROTULO_EXTERNO_NO_CONFIABLE)).toBeLessThan(salida.indexOf(MARCA_EXTERNO_INICIO));
    expect(salida.indexOf(MARCA_EXTERNO_INICIO)).toBeLessThan(salida.indexOf("hola"));
    expect(salida.indexOf("hola")).toBeLessThan(salida.indexOf(MARCA_EXTERNO_FIN));

    expect(lineas.filter((l: string) => l === MARCA_EXTERNO_INICIO)).toHaveLength(1);
    expect(lineas.filter((l: string) => l === MARCA_EXTERNO_FIN)).toHaveLength(1);
  });

  it("5b: el rótulo es la constante exportada, y va fuera y antes del marco (corrección D2)", () => {
    const salida = enmarcarTextoExterno("resultado", "cualquier contenido");

    expect(salida).toContain(ROTULO_EXTERNO_NO_CONFIABLE);
    expect(salida.indexOf(ROTULO_EXTERNO_NO_CONFIABLE)).toBeLessThan(salida.indexOf(MARCA_EXTERNO_INICIO));
  });

  it("aguja: un centinela reconocible aparece solo entre las dos marcas", () => {
    const centinela = "CENTINELA-9f3a";
    const salida = enmarcarTextoExterno("mensaje recibido", centinela);

    const inicio = salida.indexOf(MARCA_EXTERNO_INICIO);
    const fin = salida.indexOf(MARCA_EXTERNO_FIN);
    const posicionCentinela = salida.indexOf(centinela);

    expect(posicionCentinela).toBeGreaterThan(inicio);
    expect(posicionCentinela).toBeLessThan(fin);
  });
});

describe("texto-externo.ts source — PURO, sin ningún import", () => {
  it("no tiene ninguna línea 'import'", () => {
    const sourcePath = fileURLToPath(new URL("./texto-externo.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/^\s*import\b/m);
  });
});
