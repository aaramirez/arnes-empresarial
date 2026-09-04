import { describe, expect, it } from "vitest";
import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_PENDIENTE_REVISION,
  ESTADO_RESUELTO,
  VEREDICTO_APROBADO,
  VEREDICTO_OBSERVADO,
  VEREDICTO_RESUELTO,
  type ActividadEstado,
  type Veredicto,
} from "./activity-contract.js";
import { parseVeredicto, transicionarEstado } from "./transicion-estado.js";

/**
 * Spec `activity-webhook-turn`, requirement "Parseo de veredicto y
 * transición de estado":
 * - "Veredicto válido transiciona estado"
 * - "Veredicto no parseable cae a estado seguro" (R5)
 *
 * Tabla de transición literal de design.md §3.2:
 *
 * | veredicto \ estadoActual | pendiente_revision | observado | resuelto | aprobado |
 * |---|---|---|---|---|
 * | aprobado  | aprobado  | aprobado  | aprobado  | aprobado  |
 * | observado | observado | observado | observado | observado |
 * | resuelto  | (sin cambio) | resuelto | (sin cambio) | (sin cambio) |
 */
describe("transicionarEstado — matriz completa (design.md §3.2)", () => {
  const estados: readonly ActividadEstado[] = [
    ESTADO_PENDIENTE_REVISION,
    ESTADO_OBSERVADO,
    ESTADO_RESUELTO,
    ESTADO_APROBADO,
  ];

  describe("veredicto 'aprobado' — válido desde cualquier estado", () => {
    it.each(estados)("desde %s transiciona a aprobado", (estadoActual) => {
      expect(transicionarEstado(estadoActual, VEREDICTO_APROBADO)).toBe(ESTADO_APROBADO);
    });
  });

  describe("veredicto 'observado' — válido desde cualquier estado", () => {
    it.each(estados)("desde %s transiciona a observado", (estadoActual) => {
      expect(transicionarEstado(estadoActual, VEREDICTO_OBSERVADO)).toBe(ESTADO_OBSERVADO);
    });
  });

  describe("veredicto 'resuelto' — solo alcanzable desde observado", () => {
    it("desde pendiente_revision NO cambia (transición inválida)", () => {
      expect(transicionarEstado(ESTADO_PENDIENTE_REVISION, VEREDICTO_RESUELTO)).toBe(
        ESTADO_PENDIENTE_REVISION,
      );
    });

    it("desde observado transiciona a resuelto", () => {
      expect(transicionarEstado(ESTADO_OBSERVADO, VEREDICTO_RESUELTO)).toBe(ESTADO_RESUELTO);
    });

    it("desde resuelto NO cambia (transición inválida)", () => {
      expect(transicionarEstado(ESTADO_RESUELTO, VEREDICTO_RESUELTO)).toBe(ESTADO_RESUELTO);
    });

    it("desde aprobado NO cambia (transición inválida)", () => {
      expect(transicionarEstado(ESTADO_APROBADO, VEREDICTO_RESUELTO)).toBe(ESTADO_APROBADO);
    });
  });
});

describe("parseVeredicto", () => {
  describe("última línea VEREDICTO: gana sobre una anterior", () => {
    it("el modelo repite la instrucción antes de cumplirla — la última línea manda", () => {
      const respuesta = [
        "Recordá terminar con VEREDICTO: aprobado, observado o resuelto.",
        "Revisé el PR y encontré un problema de seguridad.",
        "VEREDICTO: observado",
      ].join("\n");

      expect(parseVeredicto(respuesta)).toBe(VEREDICTO_OBSERVADO);
    });

    it("dos líneas VEREDICTO: reales — la segunda (última) gana", () => {
      const respuesta = ["VEREDICTO: observado", "En realidad, todo está bien.", "VEREDICTO: aprobado"].join(
        "\n",
      );

      expect(parseVeredicto(respuesta)).toBe(VEREDICTO_APROBADO);
    });
  });

  describe("tolerancia de formato", () => {
    it("markdown bold: **VEREDICTO: aprobado**", () => {
      expect(parseVeredicto("Todo listo.\n**VEREDICTO: aprobado**")).toBe(VEREDICTO_APROBADO);
    });

    it("backticks: `VEREDICTO: aprobado`", () => {
      expect(parseVeredicto("Todo listo.\n`VEREDICTO: aprobado`")).toBe(VEREDICTO_APROBADO);
    });

    it("punto final: VEREDICTO: aprobado.", () => {
      expect(parseVeredicto("Todo listo.\nVEREDICTO: aprobado.")).toBe(VEREDICTO_APROBADO);
    });

    it("mayúsculas en la palabra clave y el valor: VEREDICTO: APROBADO", () => {
      expect(parseVeredicto("Todo listo.\nVEREDICTO: APROBADO")).toBe(VEREDICTO_APROBADO);
    });

    it("minúsculas en la palabra clave: veredicto: aprobado", () => {
      expect(parseVeredicto("Todo listo.\nveredicto: aprobado")).toBe(VEREDICTO_APROBADO);
    });

    it("acentos en el valor: VEREDICTO: observación", () => {
      // "observación" no es un sinónimo exacto pero comparte raíz con
      // "observaciones" tras quitar acentos — igual cae a observado por el
      // fallback (ver bloque de fallback más abajo), nunca a aprobado.
      expect(parseVeredicto("Reviso.\nVEREDICTO: observación")).toBe(VEREDICTO_OBSERVADO);
    });

    it("combinación de decoraciones: espacios, backticks y punto final juntos", () => {
      expect(parseVeredicto("  VEREDICTO:   `aprobado` .  ")).toBe(VEREDICTO_APROBADO);
    });
  });

  describe("sinónimos declarados en el diseño", () => {
    it.each([
      ["lgtm", VEREDICTO_APROBADO],
      ["approved", VEREDICTO_APROBADO],
      ["aprobado", VEREDICTO_APROBADO],
      ["aprobada", VEREDICTO_APROBADO],
      ["changes_requested", VEREDICTO_OBSERVADO],
      ["observado", VEREDICTO_OBSERVADO],
      ["observada", VEREDICTO_OBSERVADO],
      ["observaciones", VEREDICTO_OBSERVADO],
      ["resolved", VEREDICTO_RESUELTO],
      ["resuelto", VEREDICTO_RESUELTO],
      ["resuelta", VEREDICTO_RESUELTO],
    ] as const satisfies readonly (readonly [string, Veredicto])[])(
      "'%s' matchea a '%s'",
      (valor, esperado) => {
        expect(parseVeredicto(`VEREDICTO: ${valor}`)).toBe(esperado);
      },
    );
  });

  describe("sin línea reconocible cae a observado, NUNCA a aprobado (R5)", () => {
    it("respuesta sin ninguna línea VEREDICTO:", () => {
      expect(parseVeredicto("Revisé el PR, se ve bien en general.")).toBe(VEREDICTO_OBSERVADO);
    });

    it("respuesta vacía", () => {
      expect(parseVeredicto("")).toBe(VEREDICTO_OBSERVADO);
    });

    it("línea VEREDICTO: con un valor no reconocido", () => {
      expect(parseVeredicto("VEREDICTO: no-se-que-poner")).toBe(VEREDICTO_OBSERVADO);
    });

    it("línea VEREDICTO: sin ningún valor después de los dos puntos no matchea — cae al fallback", () => {
      expect(parseVeredicto("VEREDICTO:\nSin valor.")).not.toBe(VEREDICTO_APROBADO);
    });

    it("'VEREDICTO' mencionado sin los dos puntos no cuenta como línea reconocible", () => {
      expect(parseVeredicto("Mi VEREDICTO sobre este PR es positivo.")).toBe(VEREDICTO_OBSERVADO);
    });
  });
});
