/**
 * Test mecánico de cobertura BIDIRECCIONAL de `.env.example`
 * (`devolucion-sin-token-dos-personas`, tarea 23, ADR 232). El barrido tiene
 * DOS mitades, y las dos son obligatorias:
 *  1. **Literales**: regex `env\.([A-Z][A-Z0-9_]+)` sobre `src/**\/*.ts`,
 *     EXCLUYENDO `*.test.ts` — un `grep` ingenuo sobre TODO `src/**` daría
 *     verde con una variable que sólo un test lee, nunca el código real.
 *  2. ★ **Dinámicas, enumeradas por CÓDIGO, no por texto**:
 *     `DESTINOS_A2A.flatMap((c) => [claveAVariableEntorno(c, "ENDPOINT"),
 *     claveAVariableEntorno(c, "TOKEN")])` — importa la función y la
 *     constante REALES (`adapters/a2a/config.ts`, `core/agents/a2a-contract.ts`),
 *     no un literal hardcodeado: si el patrón de nombres cambia, este test
 *     cambia con él sin que nadie lo edite.
 *
 * El test falla en las DOS direcciones (ADR 232 pto 2): variable LEÍDA y NO
 * documentada (el caso de R10), y variable DOCUMENTADA que ya nadie lee
 * (archivo que envejece al revés).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claveAVariableEntorno } from "./adapters/a2a/config.js";
import { DESTINOS_A2A } from "./core/agents/a2a-contract.js";
import { listarArchivosTs } from "./test/listar-archivos-ts.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SRC_DIR, "..");
const ENV_EXAMPLE_PATH = join(REPO_ROOT, ".env.example");

/** Ningún valor real de secreto puede aparecer asignado en `.env.example` (ADR 232 pto 3). */
const SECRETOS = [
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "VENTAS_API_TOKEN",
  "HARNESS_A2A_ENTRANTE_TOKEN",
  "EMAIL_API_KEY",
  "GITHUB_WEBHOOK_SECRET",
] as const;

/** Mitad 1 del barrido (ADR 232 pto 1): literales `env.NOMBRE` sobre `src/**\/*.ts`, sin tests. */
function variablesLeidasLiteral(): Set<string> {
  const encontradas = new Set<string>();
  const regex = /env\.([A-Z][A-Z0-9_]+)/g;
  for (const archivo of listarArchivosTs(SRC_DIR)) {
    const contenido = readFileSync(archivo, "utf-8");
    for (const match of contenido.matchAll(regex)) {
      encontradas.add(match[1] as string);
    }
  }
  return encontradas;
}

/** ★ Mitad 2 del barrido (ADR 232 pto 1): familia dinámica de A2A, por CÓDIGO real, no por texto. */
function variablesLeidasDinamicas(): Set<string> {
  return new Set(
    DESTINOS_A2A.flatMap((clave) => [
      claveAVariableEntorno(clave, "ENDPOINT"),
      claveAVariableEntorno(clave, "TOKEN"),
    ]),
  );
}

/**
 * Un `.env.example` es una PLANTILLA: la mayoría de las entradas viajan
 * comentadas (`# NOMBRE=`) porque son opcionales, con default, y el
 * operador las descomenta sólo si quiere cambiar el comportamiento
 * (mismo criterio que ya usa este archivo para `HARNESS_A2A_SALIENTE` y
 * el resto de la familia A2A). "Documentada" cuenta la línea esté o no
 * comentada — lo que importa es que el NOMBRE aparezca con su `=`.
 */
const LINEA_VARIABLE = /^#?\s*([A-Z][A-Z0-9_]+)=/;

function variablesDocumentadas(): Set<string> {
  const contenido = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const documentadas = new Set<string>();
  for (const linea of contenido.split("\n")) {
    const match = LINEA_VARIABLE.exec(linea);
    if (match) {
      documentadas.add(match[1] as string);
    }
  }
  return documentadas;
}

describe(".env.example — cobertura bidireccional (ADR 232)", () => {
  it("toda variable leída en src/** (literal o dinámica) está documentada en .env.example", () => {
    const leidas = new Set([...variablesLeidasLiteral(), ...variablesLeidasDinamicas()]);
    const documentadas = variablesDocumentadas();

    const sinDocumentar = [...leidas].filter((v) => !documentadas.has(v));

    expect(sinDocumentar).toEqual([]);
  });

  it("toda variable documentada en .env.example se lee en algún lugar de src/** (no es un cementerio)", () => {
    const leidas = new Set([...variablesLeidasLiteral(), ...variablesLeidasDinamicas()]);
    const documentadas = variablesDocumentadas();

    const sinLector = [...documentadas].filter((v) => !leidas.has(v));

    expect(sinLector).toEqual([]);
  });

  it("★ la familia dinámica de A2A (ENDPOINT/TOKEN por cada DESTINOS_A2A) está documentada, calculada por código real", () => {
    const dinamicas = variablesLeidasDinamicas();
    const documentadas = variablesDocumentadas();

    expect(dinamicas.size).toBeGreaterThan(0);
    for (const variable of dinamicas) {
      expect(documentadas.has(variable)).toBe(true);
    }
  });

  it.each(SECRETOS)("%s no tiene ningún valor asignado en .env.example (comentada o no)", (secreto) => {
    const contenido = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
    const regexSecreto = new RegExp(`^#?\\s*${secreto}=(.*)$`, "m");
    const match = regexSecreto.exec(contenido);

    expect(match).not.toBeNull();
    expect(match?.[1] ?? "").toBe("");
  });
});
