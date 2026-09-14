import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSolicitudA2APrompt, MAX_SOLICITUD_A2A_CHARS } from "./a2a-entrante-prompt.js";
import { CONSULTAS_TOOL_QUALIFIED_NAME } from "./consultas-negocio-tool.js";

/**
 * Literal pinneado de la sección de limitación de sólo lectura
 * (`a2a-entrante-prompt.ts:62-64`). Tarea 12 exige que este fragmento quede
 * byte por byte igual — este test lo verifica por comparación exacta de
 * substring, no por `toContain` parcial de una palabra suelta.
 */
const LIMITACION_SOLO_LECTURA_LITERAL =
  "Limitación importante: esta solicitud es de sólo lectura. No podés modificar ningún dato del sistema, no podés confirmar ni ejecutar ninguna acción, y no podés delegar a otro agente. Respondé usando únicamente la información disponible, sin afirmar que realizaste alguna acción sobre el sistema.";

/**
 * Spec `solicitud-a2a-entrante` req. "`CASO_TIPO_A2A_ENTRANTE` y el prompt
 * sintético son aditivos y puros" (escenario "el prompt sintético es puro y
 * testeable sin red ni modelo") / `design.md` §5.1, ADR 91 pto 5, ADR 95, ADR
 * 98 pto 6.
 *
 * `buildSolicitudA2APrompt` es una función PURA: mismo input, mismo string.
 * Molde: `src/core/ventas/soporte-prompt.test.ts`.
 */

describe("buildSolicitudA2APrompt — determinismo", () => {
  it("mismo input produce exactamente el mismo string (función pura)", () => {
    const texto = "¿Cuál es el estado del caso 42?";
    const primero = buildSolicitudA2APrompt(texto);
    const segundo = buildSolicitudA2APrompt(texto);
    expect(primero).toBe(segundo);
  });
});

describe("buildSolicitudA2APrompt — cuatro secciones presentes y en orden", () => {
  it("incluye el rol, la solicitud, la limitación de sólo lectura y la instrucción de honestidad, en ese orden", () => {
    const texto = "Necesito el detalle del incidente KPI-9";
    const prompt = buildSolicitudA2APrompt(texto);
    const promptLower = prompt.toLowerCase();

    const idxRol = promptLower.indexOf("a2a");
    const idxSolicitud = prompt.indexOf(texto);
    const idxLimitacion = promptLower.indexOf("sólo lectura");
    const idxHonestidad = promptLower.indexOf("inventar");

    expect(idxRol).toBeGreaterThanOrEqual(0);
    expect(idxSolicitud).toBeGreaterThan(idxRol);
    expect(idxLimitacion).toBeGreaterThan(idxSolicitud);
    expect(idxHonestidad).toBeGreaterThan(idxLimitacion);
  });
});

describe("buildSolicitudA2APrompt — limitación de sólo lectura declarada literal", () => {
  it('incluye literalmente "esta solicitud es de sólo lectura" y "no podés delegar a otro agente"', () => {
    const prompt = buildSolicitudA2APrompt("¿Cuál es el estado del caso 7?");
    const promptLower = prompt.toLowerCase();

    expect(promptLower).toContain("esta solicitud es de sólo lectura");
    expect(promptLower).toContain("no podés delegar a otro agente");
  });

  it("incluye la limitación aun con un texto vacío", () => {
    const prompt = buildSolicitudA2APrompt("");
    const promptLower = prompt.toLowerCase();

    expect(promptLower).toContain("esta solicitud es de sólo lectura");
    expect(promptLower).toContain("no podés delegar a otro agente");
  });
});

describe("buildSolicitudA2APrompt — instrucción de honestidad", () => {
  it("instruye no inventar una respuesta cuando falta información", () => {
    const prompt = buildSolicitudA2APrompt("¿Cuánto vale la venta 12?");
    expect(prompt.toLowerCase()).toContain("inventar");
  });
});

describe("buildSolicitudA2APrompt — truncado del texto", () => {
  it("NO trunca un texto corto, dentro del tope", () => {
    const textoCorto = "¿El caso 3 sigue abierto?";
    const prompt = buildSolicitudA2APrompt(textoCorto);

    expect(prompt).toContain(textoCorto);
    expect(prompt).not.toContain("[…truncado]");
  });

  it("trunca a MAX_SOLICITUD_A2A_CHARS (8_000) cuando el texto excede el tope, con marca […truncado]", () => {
    expect(MAX_SOLICITUD_A2A_CHARS).toBe(8_000);

    const textoLargo = "Q".repeat(MAX_SOLICITUD_A2A_CHARS + 1);
    const prompt = buildSolicitudA2APrompt(textoLargo);

    expect(prompt).toContain(`${"Q".repeat(MAX_SOLICITUD_A2A_CHARS)}[…truncado]`);
    expect(prompt.includes("Q".repeat(MAX_SOLICITUD_A2A_CHARS + 1))).toBe(false);
  });
});

describe("buildSolicitudA2APrompt — texto vacío no lanza (función total)", () => {
  it("no lanza con un texto vacío y devuelve un string no vacío", () => {
    expect(() => buildSolicitudA2APrompt("")).not.toThrow();
    expect(buildSolicitudA2APrompt("").length).toBeGreaterThan(0);
  });
});

describe("buildSolicitudA2APrompt — la limitación de sólo lectura queda byte por byte igual (tarea 12)", () => {
  it("conserva literal, sin cambios, la sección completa de limitación de sólo lectura", () => {
    const prompt = buildSolicitudA2APrompt("¿Cuál es el estado del caso 7?");
    expect(prompt).toContain(LIMITACION_SOLO_LECTURA_LITERAL);
  });
});

describe("buildSolicitudA2APrompt — instrucción de uso de consultar_negocio (tarea 12, Hallazgo 1)", () => {
  it("instruye usar la tool de consultas antes de responder con una generalidad, referenciando el nombre real de la tool", () => {
    const prompt = buildSolicitudA2APrompt("¿Cuántas solicitudes hay pendientes?");

    expect(prompt).toContain(CONSULTAS_TOOL_QUALIFIED_NAME);
    expect(prompt.toLowerCase()).toContain("antes de responder con una generalidad");
  });

  it("la instrucción de uso de la tool queda entre la limitación de sólo lectura y la instrucción de honestidad", () => {
    const prompt = buildSolicitudA2APrompt("¿Cuál es el estado del caso 7?");
    const promptLower = prompt.toLowerCase();

    const idxLimitacion = promptLower.indexOf("sólo lectura");
    const idxTool = prompt.indexOf(CONSULTAS_TOOL_QUALIFIED_NAME);
    const idxHonestidad = promptLower.indexOf("inventar");

    expect(idxTool).toBeGreaterThan(idxLimitacion);
    expect(idxHonestidad).toBeGreaterThan(idxTool);
  });
});

describe("a2a-entrante-prompt.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./a2a-entrante-prompt.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
