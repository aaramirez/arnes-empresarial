import { describe, expect, it } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition } from "./definitions.js";
import {
  construirTareaDelegada,
  TAREA_DELEGADA_MAX_CHARS,
  TAREA_TRUNCADA_SUFIJO,
  truncarTareaDelegada,
  type InsumoDelegado,
  type InvocarSubagente,
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

/**
 * Hito 6, tarea 11 (`design.md` §5.4). `truncarTareaDelegada` pasa a
 * exportada para testeo unitario directo de la lógica de truncado,
 * independiente de `ensamblarTareaDelegada` (code-review, hallazgo 5: el
 * consumidor real hoy NO es `dispatch-delegation-a2a.ts` — ese archivo
 * importa `ensamblarTareaDelegada`, que llama a `truncarTareaDelegada`
 * internamente, no la función directa; el único consumidor directo del
 * export es este propio test). Mismo comportamiento que ya se prueba
 * indirectamente vía `construirTareaDelegada` — acá se ejercita directo, vía
 * import.
 */
describe("truncarTareaDelegada — reuso externo (exportada)", () => {
  it("trunca un texto más largo que TAREA_DELEGADA_MAX_CHARS agregando TAREA_TRUNCADA_SUFIJO", () => {
    const textoLargo = "X".repeat(TAREA_DELEGADA_MAX_CHARS + 500);
    const resultado = truncarTareaDelegada(textoLargo);

    expect(resultado).toBe(
      `${textoLargo.slice(0, TAREA_DELEGADA_MAX_CHARS)}${TAREA_TRUNCADA_SUFIJO}`,
    );
  });
});

/**
 * Hito 5.1, tarea 27 (§5.3, ADR 67 pto 4 — primera mitad, "propagación hasta
 * el SDK"). `InvocarSubagente` gana `cwd?`/`mcpServers?` opcionales en su
 * input. Es un cambio ADITIVO sobre un TIPO — no hay una función concreta acá
 * que lo implemente (el composition root la cierra sobre `invokeModel`,
 * tareas 14/28); lo que este bloque prueba es el CONTRATO:
 *
 *  (a) un call site de v2.0.0 que arma el input con solo
 *      `agent`/`casoId`/`tareaDelegada` sigue tipando y ejecutando IGUAL, sin
 *      que `cwd`/`mcpServers` aparezcan en el objeto recibido (regresión); y
 *  (b) un call site nuevo puede agregar `cwd`/`mcpServers` sin que TypeScript
 *      los rechace como propiedades desconocidas del objeto literal (excess
 *      property check).
 *
 * El gate REAL del caso (b) es `npx tsc --noEmit`, no `npx vitest run`:
 * vitest corre sobre JS transpilado por esbuild, que borra los tipos y no
 * hace excess-property-check — un objeto literal con `cwd`/`mcpServers` de
 * más EJECUTA igual aunque el tipo no los declare. Antes de tocar
 * `subagents.ts`, este archivo NO compila (`tsc --noEmit` marca `cwd`,
 * `mcpServers` y `recibido?.cwd`/`recibido?.mcpServers` como propiedades
 * inexistentes en el tipo) — ese es el RED de esta tarea. Una vez agregados
 * los dos campos opcionales al tipo, compila limpio y las mismas
 * aserciones en runtime confirman que los valores viajan intactos.
 */
describe("InvocarSubagente — cwd y mcpServers opcionales (Hito 5.1, tarea 27)", () => {
  it("un call site de v2.0.0 (sin cwd ni mcpServers) sigue compilando y ejecutando igual", async () => {
    const recibidos: unknown[] = [];
    const invocar: InvocarSubagente = async (input) => {
      recibidos.push(input);
      return { responseText: "resultado v2.0.0", sdkSessionId: "sdk-v2" };
    };

    const resultado = await invocar({
      agent: ROL_BASE,
      casoId: "caso-v2",
      tareaDelegada: "tarea sin cwd ni mcpServers",
    });

    expect(resultado).toEqual({ responseText: "resultado v2.0.0", sdkSessionId: "sdk-v2" });
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0]).not.toHaveProperty("cwd");
    expect(recibidos[0]).not.toHaveProperty("mcpServers");
  });

  it("acepta cwd y mcpServers opcionales adicionales, y los propaga intactos (ADR 67 pto 4)", async () => {
    const cwdEsperado = "/tmp/harness/worktrees/caso-nuevo";
    const mcpServersEsperado: NonNullable<Options["mcpServers"]> = {
      worktree: { type: "stdio", command: "vitest-worktree-tool" },
    };
    let recibido: Parameters<InvocarSubagente>[0] | undefined;

    const invocar: InvocarSubagente = async (input) => {
      recibido = input;
      return { responseText: "resultado con escritura", sdkSessionId: "sdk-escritura" };
    };

    await invocar({
      agent: ROL_BASE,
      casoId: "caso-nuevo",
      tareaDelegada: "tarea con escritura habilitada",
      cwd: cwdEsperado,
      mcpServers: mcpServersEsperado,
    });

    expect(recibido?.cwd).toBe(cwdEsperado);
    expect(recibido?.mcpServers).toBe(mcpServersEsperado);
  });
});
