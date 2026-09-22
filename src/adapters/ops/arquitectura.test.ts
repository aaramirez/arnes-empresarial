/**
 * Candado estructural (S5, R33) — NACE VERDE, es un test mecánico de
 * no-regresión: se lee el FUENTE de `src/adapters/ops/` con `readFileSync` y
 * se afirma que ningún `import` sale del conjunto permitido. Su valor no es
 * "detectar un bug hoy" sino "ponerse rojo el día que alguien agregue el
 * tercero de turno" (Claude, GitHub, `graphify`, otro adaptador). Se valida
 * por MUTACIÓN en la tarea 2.6 (M3: agregar un import a `web/config.ts`).
 *
 * `readiness.ts` nace en el slice D (tarea 4.1) con el escenario adicional
 * de abajo: cero líneas de import en ese archivo puntual (S5, S14) —
 * duplicado a propósito con el test dedicado de `readiness.test.ts`, que
 * es el rojo de tipo original; este es el candado estructural que barre
 * TODOS los archivos, no solo ese uno.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const OPS_DIR = dirname(fileURLToPath(import.meta.url));

function listarArchivosTs(dir: string): string[] {
  const archivos: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...listarArchivosTs(ruta));
      continue;
    }
    if (entrada.name.endsWith(".ts")) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

/** Extrae los especificadores de TODO `import ... from "X"` y `import "X";` de efecto. */
function especificadoresDeImport(contenido: string): string[] {
  const especificadores: string[] = [];
  const regexFrom = /import\s+[\s\S]*?from\s+["']([^"']+)["']/g;
  const regexEfecto = /^\s*import\s+["']([^"']+)["'];?\s*$/gm;
  for (const match of contenido.matchAll(regexFrom)) {
    especificadores.push(match[1] as string);
  }
  for (const match of contenido.matchAll(regexEfecto)) {
    especificadores.push(match[1] as string);
  }
  return especificadores;
}

const TODOS_LOS_ARCHIVOS = listarArchivosTs(OPS_DIR);
const FUENTES_NO_TEST = TODOS_LOS_ARCHIVOS.filter((archivo) => !archivo.endsWith(".test.ts"));
const ARCHIVOS_DE_TEST = TODOS_LOS_ARCHIVOS.filter((archivo) => archivo.endsWith(".test.ts"));

function nombreBase(ruta: string): string {
  return ruta.split(/[/\\]/).pop() as string;
}

describe("Arquitectura — src/adapters/ops/ no importa de otro adaptador ni hace I/O externa (S5, candado que nace verde)", () => {
  it("todo especificador de import de las fuentes no-test es relativo ./..., o node:http, o ../../core/config/env.js SOLO en config.ts", () => {
    for (const archivo of FUENTES_NO_TEST) {
      const contenido = readFileSync(archivo, "utf-8");
      const nombre = nombreBase(archivo);
      for (const especificador of especificadoresDeImport(contenido)) {
        const esRelativo = especificador.startsWith("./");
        const esNodeHttp = especificador === "node:http";
        const esEnvDeConfig = especificador === "../../core/config/env.js" && nombre === "config.ts";
        const permitido = esRelativo || esNodeHttp || esEnvDeConfig;
        expect(permitido, `import inesperado "${especificador}" en ${nombre}`).toBe(true);
      }
    }
  });

  it("ningun import apunta a ../web, ../webhooks, ../a2a, ../memory, ni a un ../../core/** distinto del env.js citado", () => {
    const rutasDeAdaptadorProhibidas = ["../web", "../webhooks", "../a2a", "../memory"];
    for (const archivo of FUENTES_NO_TEST) {
      const contenido = readFileSync(archivo, "utf-8");
      const nombre = nombreBase(archivo);
      for (const especificador of especificadoresDeImport(contenido)) {
        for (const prohibida of rutasDeAdaptadorProhibidas) {
          expect(
            especificador.startsWith(prohibida),
            `${nombre} importa de otro adaptador via "${especificador}"`,
          ).toBe(false);
        }
        if (especificador.startsWith("../../core/")) {
          expect(
            especificador === "../../core/config/env.js" && nombre === "config.ts",
            `${nombre} importa de core/ fuera del env.js citado: "${especificador}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("ninguna fuente no-test importa node:fs, node:https, node:net, node:child_process ni llama a fetch(", () => {
    const prohibidos = ["node:fs", "node:https", "node:net", "node:child_process"];
    for (const archivo of FUENTES_NO_TEST) {
      const contenido = readFileSync(archivo, "utf-8");
      const nombre = nombreBase(archivo);
      for (const prohibido of prohibidos) {
        expect(contenido.includes(prohibido), `${nombre} referencia "${prohibido}"`).toBe(false);
      }
      expect(contenido.includes("fetch("), `${nombre} llama a fetch(`).toBe(false);
    }
  });

  it("los *.test.ts no importan node:http ni node:net (cero sockets en la suite)", () => {
    const literalesProhibidos = ['from "node:http"', "from 'node:http'", 'from "node:net"', "from 'node:net'"];
    const esteArchivo = fileURLToPath(import.meta.url);
    for (const archivo of ARCHIVOS_DE_TEST) {
      if (archivo === esteArchivo) {
        continue; // este propio archivo menciona los literales en el mensaje de fallo; no se audita a sí mismo.
      }
      const contenido = readFileSync(archivo, "utf-8");
      const nombre = nombreBase(archivo);
      for (const literal of literalesProhibidos) {
        expect(contenido.includes(literal), `${nombre} contiene "${literal}"`).toBe(false);
      }
    }
  });

  it("OpsRequest declara EXACTAMENTE method y url, y closeIdleConnections NO es opcional (http.ts)", () => {
    const contenido = readFileSync(join(OPS_DIR, "http.ts"), "utf-8");

    const bloqueOpsRequest = contenido.match(/export interface OpsRequest \{([\s\S]*?)\n\}/);
    expect(bloqueOpsRequest).not.toBeNull();
    const propiedades = [...(bloqueOpsRequest as RegExpMatchArray)[1]!.matchAll(/readonly\s+(\w+)/g)].map(
      (match) => match[1],
    );
    expect(propiedades.sort()).toEqual(["method", "url"]);

    expect(contenido).toMatch(/closeIdleConnections\(\):\s*unknown;/);
    expect(contenido).not.toMatch(/closeIdleConnections\?\(/);
  });

  it("readiness.ts no tiene ninguna línea de import (S5, S14, slice D)", () => {
    const contenido = readFileSync(join(OPS_DIR, "readiness.ts"), "utf-8");
    expect(contenido).not.toMatch(/^\s*import\b/m);
  });
});
