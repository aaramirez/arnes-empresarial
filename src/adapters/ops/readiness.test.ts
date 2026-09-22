/**
 * Test-first (RED de TIPO) de `src/adapters/ops/readiness.ts` (hijo 3,
 * ADR 258, S14). El módulo bajo test TODAVÍA NO EXISTE: `npm run typecheck`
 * y `npm test -- readiness` deben fallar los dos, a propósito.
 *
 * `evaluarReadiness` es PURA y TOTAL: prioridad fija `cerrando > base >
 * listener`, `undefined` solo cuando los tres hechos son sanos. Sin ningún
 * `import` en el archivo bajo test (verificado acá con `readFileSync`, y
 * también en `arquitectura.test.ts` para que el candado estructural cubra
 * `readiness.ts` desde que nace).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EstadoSalud, MotivoNoListo } from "./readiness.js";
import { evaluarReadiness } from "./readiness.js";

function estado(overrides: Partial<EstadoSalud> = {}): EstadoSalud {
  return {
    cerrando: false,
    baseUtilizable: true,
    listenersCaidos: 0,
    ...overrides,
  };
}

describe("evaluarReadiness (S14, ADR 258) — pura y total, prioridad cerrando > base > listener", () => {
  it.each([
    // [cerrando, baseUtilizable, listenersCaidos, esperado]
    [true, true, 0, "cerrando"],
    [true, true, 1, "cerrando"],
    [true, false, 0, "cerrando"],
    [true, false, 1, "cerrando"],
    [false, false, 0, "base"],
    [false, false, 1, "base"],
    [false, true, 1, "listener"],
    [false, true, 0, undefined],
  ] as const)(
    "cerrando=%s baseUtilizable=%s listenersCaidos=%s ⇒ %s",
    (cerrando, baseUtilizable, listenersCaidos, esperado) => {
      const resultado: MotivoNoListo | undefined = evaluarReadiness(
        estado({ cerrando, baseUtilizable, listenersCaidos }),
      );
      expect(resultado).toBe(esperado);
    },
  );

  it("undefined ocurre SOLO con los tres hechos sanos", () => {
    const combinaciones = [
      estado({ cerrando: true }),
      estado({ baseUtilizable: false }),
      estado({ listenersCaidos: 1 }),
      estado({ cerrando: true, baseUtilizable: false, listenersCaidos: 3 }),
    ];
    for (const caso of combinaciones) {
      expect(evaluarReadiness(caso)).not.toBeUndefined();
    }
    expect(evaluarReadiness(estado())).toBeUndefined();
  });

  it.each([
    [0, undefined],
    [1, "listener"],
    [3, "listener"],
  ] as const)("borde de listenersCaidos=%s ⇒ %s", (listenersCaidos, esperado) => {
    expect(evaluarReadiness(estado({ listenersCaidos }))).toBe(esperado);
  });

  it("determinismo: 1000 evaluaciones idénticas sobre el mismo EstadoSalud, sin mutar la entrada", () => {
    const entrada: EstadoSalud = estado({ cerrando: true, baseUtilizable: false, listenersCaidos: 2 });
    const copia = { ...entrada };
    const resultados = new Set<MotivoNoListo | undefined>();
    for (let i = 0; i < 1_000; i += 1) {
      resultados.add(evaluarReadiness(entrada));
    }
    expect(resultados.size).toBe(1);
    expect(resultados.has("cerrando")).toBe(true);
    expect(entrada).toEqual(copia);
  });

  it("readiness.ts no tiene ninguna línea de import ni require( (S5)", () => {
    const fuente = readFileSync(new URL("./readiness.ts", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/^\s*import\b/m);
    expect(fuente).not.toMatch(/require\(/);
  });
});
