import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "./definitions.js";
import {
  construirTareaDelegada,
  TAREA_DELEGADA_MAX_CHARS,
  TAREA_TRUNCADA_SUFIJO,
  type InsumoDelegado,
} from "./subagents.js";

/**
 * Spec `delegacion-subagentes` req. "`tarea_delegada` contiene solo la tarea,
 * nunca el historial del padre" / `design.md` §5.3.
 *
 * `construirTareaDelegada` es una función PURA: mismo input, mismo string.
 * Sin fixture de LLM — `InvocarSubagente` es solo un tipo de puerto acá, se
 * ejercita con doble recién en la tarea 8.
 */

const ROL_BASE: AgentDefinition = {
  id: "rol-de-prueba",
  description: "Rol de prueba para ejercitar construirTareaDelegada.",
  systemPrompt: "PROMPT SECRETO DEL ROL — no debe aparecer nunca en tarea_delegada.",
  allowedTools: [],
  model: "sonnet",
};

function insumoBase(overrides: Partial<InsumoDelegado> = {}): InsumoDelegado {
  return {
    instruccion: "Analizá el PR y armá el plan de revisión.",
    material: "Metadatos del PR: título, cuerpo, archivos cambiados.",
    ...overrides,
  };
}

describe("construirTareaDelegada — pureza", () => {
  it("mismo input produce exactamente el mismo string (función pura)", () => {
    const insumo = insumoBase();
    const primero = construirTareaDelegada(ROL_BASE, insumo);
    const segundo = construirTareaDelegada(ROL_BASE, insumo);
    expect(primero).toBe(segundo);
  });
});

describe("construirTareaDelegada — aislamiento (nunca el system prompt del rol)", () => {
  it("el texto ensamblado no contiene el systemPrompt del rol", () => {
    const resultado = construirTareaDelegada(ROL_BASE, insumoBase());
    expect(resultado).not.toContain(ROL_BASE.systemPrompt);
  });

  it("incluye la instrucción y el material del insumo, verbatim, cuando entran dentro del tope", () => {
    const insumo = insumoBase();
    const resultado = construirTareaDelegada(ROL_BASE, insumo);
    expect(resultado).toContain(insumo.instruccion);
    expect(resultado).toContain(insumo.material);
  });
});

describe("construirTareaDelegada — InsumoDelegado.material es siempre string plano", () => {
  it("acepta como material el texto (opaco) de la salida del rol anterior, sin interpretarlo", () => {
    // `material` es `string` — no hay ningún tipo por el que pueda colarse un
    // historial de sesión (objeto, sdkSessionId, mensajes, etc.). El único
    // canal es texto plano, tal como lo tipa `InsumoDelegado`.
    const salidaComoTextoPlano = JSON.stringify({
      sdkSessionId: "sesion-no-deberia-viajar-asi",
      mensajes: ["esto NO es un historial real, es un string opaco"],
    });
    const insumo = insumoBase({ material: salidaComoTextoPlano });

    const resultado = construirTareaDelegada(ROL_BASE, insumo);

    // Entra como texto opaco, tal cual — la función no lo parsea ni le da
    // tratamiento especial por "parecer" una sesión.
    expect(resultado).toContain(salidaComoTextoPlano);
  });
});

describe("construirTareaDelegada — truncado con TAREA_DELEGADA_MAX_CHARS", () => {
  it("TAREA_DELEGADA_MAX_CHARS es 8000 y TAREA_TRUNCADA_SUFIJO es el string exacto del diseño", () => {
    expect(TAREA_DELEGADA_MAX_CHARS).toBe(8_000);
    expect(TAREA_TRUNCADA_SUFIJO).toBe("\n[…tarea truncada por tope de tamaño…]");
  });

  it("NO trunca cuando el texto ensamblado está dentro del tope", () => {
    const resultado = construirTareaDelegada(ROL_BASE, insumoBase());
    expect(resultado).not.toContain(TAREA_TRUNCADA_SUFIJO);
  });

  it("trunca a TAREA_DELEGADA_MAX_CHARS agregando TAREA_TRUNCADA_SUFIJO cuando el texto excede el tope", () => {
    const materialLargo = "M".repeat(TAREA_DELEGADA_MAX_CHARS + 500);
    const resultado = construirTareaDelegada(ROL_BASE, insumoBase({ material: materialLargo }));

    expect(resultado).toContain(TAREA_TRUNCADA_SUFIJO);
    expect(resultado.startsWith(resultado.slice(0, TAREA_DELEGADA_MAX_CHARS))).toBe(true);
    expect(resultado).toBe(
      `${resultado.slice(0, TAREA_DELEGADA_MAX_CHARS)}${TAREA_TRUNCADA_SUFIJO}`,
    );
    // El material completo sin truncar no debe aparecer literal en el resultado.
    expect(resultado.includes("M".repeat(TAREA_DELEGADA_MAX_CHARS + 1))).toBe(false);
  });
});
