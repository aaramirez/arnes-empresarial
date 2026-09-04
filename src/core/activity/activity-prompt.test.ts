import { describe, expect, it } from "vitest";
import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  VEREDICTO_PREFIX,
  VEREDICTOS,
  type Actividad,
  type ActividadEstado,
  type PullRequestMetadata,
} from "./activity-contract.js";
import {
  buildActivityPrompt,
  MAX_PROMPT_ARCHIVOS,
  MAX_PROMPT_COMENTARIO_CHARS,
  MAX_PROMPT_CUERPO_CHARS,
  MAX_PROMPT_TITULO_CHARS,
  type ActivityPromptContext,
} from "./activity-prompt.js";

/**
 * Spec `activity-webhook-turn` / `proposal.md` ("Approach — Agente y prompt
 * sintético") / `design.md` §3.2 `activity-prompt.ts`.
 *
 * `buildActivityPrompt` es una función PURA: mismo input, mismo string. No
 * hay mocks acá — solo actividades y contextos literales.
 */

const ACTIVIDAD_BASE: Actividad = {
  id: "actividad-1",
  proyectoId: "acme/repo",
  tipo: "pr_review",
  referenciaExterna: "42",
  casoId: "caso-1",
  estado: ESTADO_PENDIENTE_REVISION,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const METADATOS_BASE: PullRequestMetadata = {
  titulo: "Agrega validación de entrada",
  cuerpo: "Este PR agrega validación en el endpoint X.",
  autor: "octocat",
  archivosCambiados: ["src/a.ts", "src/b.ts"],
  archivosTruncados: false,
};

/**
 * Overrides de test. A diferencia de `Partial<ActivityPromptContext>`, acá
 * `metadatos`/`comentarioDisparador` aceptan `undefined` EXPLÍCITO — es
 * justamente lo que varios casos de este archivo necesitan simular (el
 * tablero no pudo leer metadatos, o no hubo comentario disparador). El
 * objeto final se arma con spread condicional para no violarle
 * `exactOptionalPropertyTypes` a `ActivityPromptContext`.
 */
interface ContextoOverrides {
  readonly metadatos?: PullRequestMetadata | undefined;
  readonly comentarioDisparador?: string | undefined;
  readonly estadoActual?: ActividadEstado;
  readonly titulo?: string;
  readonly cuerpo?: string;
}

function contextoBase(overrides: ContextoOverrides = {}): ActivityPromptContext {
  const metadatos = "metadatos" in overrides ? overrides.metadatos : METADATOS_BASE;
  const comentarioDisparador = overrides.comentarioDisparador;

  return {
    estadoActual: overrides.estadoActual ?? ESTADO_PENDIENTE_REVISION,
    // fallback distinto del de metadatos, para detectar cuál usó el prompt
    titulo: overrides.titulo ?? ACTIVIDAD_BASE.id,
    cuerpo: overrides.cuerpo ?? "cuerpo de fallback del evento",
    ...(metadatos !== undefined ? { metadatos } : {}),
    ...(comentarioDisparador !== undefined ? { comentarioDisparador } : {}),
  };
}

describe("buildActivityPrompt — determinismo", () => {
  it("mismo input produce exactamente el mismo string (función pura)", () => {
    const contexto = contextoBase();
    const primero = buildActivityPrompt(ACTIVIDAD_BASE, contexto);
    const segundo = buildActivityPrompt(ACTIVIDAD_BASE, contexto);
    expect(primero).toBe(segundo);
  });
});

describe("buildActivityPrompt — instrucción de veredicto", () => {
  it("incluye VEREDICTO_PREFIX importado del contrato", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase());
    expect(prompt).toContain(VEREDICTO_PREFIX);
  });

  it("enumera los tres valores de VEREDICTOS importados del contrato", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase());
    for (const veredicto of VEREDICTOS) {
      expect(prompt).toContain(veredicto);
    }
  });
});

describe("buildActivityPrompt — truncado con topes exactos del diseño", () => {
  it("trunca el título cuando excede MAX_PROMPT_TITULO_CHARS, con marca […truncado]", () => {
    const tituloLargo = "T".repeat(MAX_PROMPT_TITULO_CHARS + 100);
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ metadatos: { ...METADATOS_BASE, titulo: tituloLargo } }),
    );

    expect(prompt).toContain("[…truncado]");
    expect(prompt).not.toContain(tituloLargo);
    // El título completo sin truncar no debe aparecer literal en el prompt.
    expect(prompt.includes("T".repeat(MAX_PROMPT_TITULO_CHARS + 1))).toBe(false);
  });

  it("NO trunca el título cuando está dentro del tope", () => {
    const tituloCorto = "Un título corto";
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ metadatos: { ...METADATOS_BASE, titulo: tituloCorto } }),
    );

    expect(prompt).toContain(tituloCorto);
  });

  it("trunca el cuerpo cuando excede MAX_PROMPT_CUERPO_CHARS, con marca […truncado]", () => {
    const cuerpoLargo = "C".repeat(MAX_PROMPT_CUERPO_CHARS + 500);
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ metadatos: { ...METADATOS_BASE, cuerpo: cuerpoLargo } }),
    );

    expect(prompt).toContain("[…truncado]");
    expect(prompt.includes("C".repeat(MAX_PROMPT_CUERPO_CHARS + 1))).toBe(false);
  });

  it("trunca el comentario disparador cuando excede MAX_PROMPT_COMENTARIO_CHARS, con marca […truncado]", () => {
    const comentarioLargo = "X".repeat(MAX_PROMPT_COMENTARIO_CHARS + 200);
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ comentarioDisparador: comentarioLargo }),
    );

    expect(prompt).toContain("[…truncado]");
    expect(prompt.includes("X".repeat(MAX_PROMPT_COMENTARIO_CHARS + 1))).toBe(false);
  });

  it("trunca la lista de archivos cambiados a MAX_PROMPT_ARCHIVOS, con marca '(… y N archivos más)'", () => {
    const totalArchivos = MAX_PROMPT_ARCHIVOS + 7;
    const archivos = Array.from({ length: totalArchivos }, (_, i) => `src/archivo-${i}.ts`);
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ metadatos: { ...METADATOS_BASE, archivosCambiados: archivos } }),
    );

    expect(prompt).toContain("(… y 7 archivos más)");
    // El último archivo de la lista completa no debería aparecer.
    expect(prompt).not.toContain(`src/archivo-${totalArchivos - 1}.ts`);
    // El primero (dentro del tope) sí.
    expect(prompt).toContain("src/archivo-0.ts");
  });

  it("NO agrega marca de recorte cuando la lista de archivos está dentro del tope", () => {
    const archivos = Array.from({ length: MAX_PROMPT_ARCHIVOS }, (_, i) => `src/archivo-${i}.ts`);
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ metadatos: { ...METADATOS_BASE, archivosCambiados: archivos } }),
    );

    expect(prompt).not.toContain("archivos más");
  });
});

describe("buildActivityPrompt — sin metadatos (degradación de tablero)", () => {
  it("usa los fallbacks del evento (titulo/cuerpo) cuando metadatos es undefined", () => {
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({
        metadatos: undefined,
        titulo: "Título del evento crudo",
        cuerpo: "Cuerpo del evento crudo",
      }),
    );

    expect(prompt).toContain("Título del evento crudo");
    expect(prompt).toContain("Cuerpo del evento crudo");
    // Nada del metadatos de ejemplo debe filtrarse.
    expect(prompt).not.toContain(METADATOS_BASE.titulo);
  });

  it("declara explícitamente que no se pudieron obtener metadatos completos del tablero", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase({ metadatos: undefined }));

    expect(prompt.toLowerCase()).toMatch(/no se pudieron (leer|obtener)/);
    expect(prompt.toLowerCase()).toContain("tablero");
  });

  it("usa una lista de archivos vacía sin metadatos, sin lanzar", () => {
    expect(() =>
      buildActivityPrompt(ACTIVIDAD_BASE, contextoBase({ metadatos: undefined })),
    ).not.toThrow();
  });
});

describe("buildActivityPrompt — framing según comentarioDisparador", () => {
  it("con comentarioDisparador: pide verificar si resuelve las observaciones anteriores", () => {
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({
        estadoActual: ESTADO_OBSERVADO,
        comentarioDisparador: "Ya arreglé lo que pediste.",
      }),
    );

    expect(prompt.toLowerCase()).toContain("observaciones anteriores");
    expect(prompt).toContain("Ya arreglé lo que pediste.");
  });

  it("sin comentarioDisparador: usa el framing de primera revisión, no el de verificación", () => {
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ comentarioDisparador: undefined }),
    );

    expect(prompt.toLowerCase()).not.toContain("observaciones anteriores");
  });
});

describe("buildActivityPrompt — limitación declarada de R4 (sin diff completo)", () => {
  it("aclara explícitamente que no tiene el diff completo del PR", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase());
    expect(prompt.toLowerCase()).toContain("diff");
    expect(prompt.toLowerCase()).toMatch(/no ten[eé]s (el )?diff/);
  });

  it("nunca sugiere revisar los cambios línea por línea sin aclarar la limitación en el mismo prompt", () => {
    const casos: ActivityPromptContext[] = [
      contextoBase(),
      contextoBase({ metadatos: undefined }),
      contextoBase({ comentarioDisparador: "resolví todo" }),
    ];

    for (const contexto of casos) {
      const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contexto);
      const sugiereLineaAPorLinea = /l[ií]nea por l[ií]nea/i.test(prompt);
      if (sugiereLineaAPorLinea) {
        // Si en algún momento el prompt mencionara "línea por línea", DEBE
        // convivir con la aclaración de que no hay diff disponible.
        expect(prompt.toLowerCase()).toMatch(/no ten[eé]s (el )?diff/);
      }
      // En ningún caso el prompt debe omitir la limitación declarada.
      expect(prompt.toLowerCase()).toMatch(/no ten[eé]s (el )?diff/);
    }
  });
});

describe("buildActivityPrompt — estructura general", () => {
  it("referencia proyectoId y referenciaExterna de la actividad", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase());
    expect(prompt).toContain(ACTIVIDAD_BASE.proyectoId);
    expect(prompt).toContain(ACTIVIDAD_BASE.referenciaExterna);
  });

  it("incluye el estadoActual recibido en el contexto", () => {
    const prompt = buildActivityPrompt(
      ACTIVIDAD_BASE,
      contextoBase({ estadoActual: ESTADO_APROBADO }),
    );
    expect(prompt).toContain(ESTADO_APROBADO);
  });

  it("incluye la lista de archivos cambiados de los metadatos cuando están presentes", () => {
    const prompt = buildActivityPrompt(ACTIVIDAD_BASE, contextoBase());
    for (const archivo of METADATOS_BASE.archivosCambiados) {
      expect(prompt).toContain(archivo);
    }
  });
});
