import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Helper de test compartido (Reviewer finding, reuse): antes de este
 * archivo, `src/env-example.test.ts`, `src/adapters/ops/config.test.ts` y
 * `src/adapters/ops/arquitectura.test.ts` declaraban su propia copia de esta
 * función. `src/test/` es la ubicación elegida porque ya existe (alberga
 * `src/test/integration/`) y no crea un directorio nuevo solo para esto.
 *
 * Recorre `dir` recursivamente y devuelve los `.ts` de FUENTE, excluyendo
 * `*.test.ts` (mitad 1 del barrido de `env-example.test.ts`, ADR 232 pto 1;
 * mismo criterio en `config.test.ts`).
 */
export function listarArchivosTs(dir: string): string[] {
  const archivos: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...listarArchivosTs(ruta));
      continue;
    }
    if (entrada.name.endsWith(".ts") && !entrada.name.endsWith(".test.ts")) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

/**
 * Variante que INCLUYE `*.test.ts` (usada por
 * `src/adapters/ops/arquitectura.test.ts`, que necesita auditar también los
 * propios tests — p. ej. "los `*.test.ts` no importan `node:http`").
 * Deliberadamente NO es un parámetro opcional de `listarArchivosTs`: dos
 * funciones con nombre explícito son más claras en el call-site que un
 * booleano posicional (`incluirTests: true`).
 */
export function listarTodosLosArchivosTs(dir: string): string[] {
  const archivos: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...listarTodosLosArchivosTs(ruta));
      continue;
    }
    if (entrada.name.endsWith(".ts")) {
      archivos.push(ruta);
    }
  }
  return archivos;
}
