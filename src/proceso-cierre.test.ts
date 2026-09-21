/**
 * Test-first (RED) de `src/proceso-cierre.ts` (`modo-headless-cierre-limpio`,
 * tarea 2.1, ADR 248/249 pto 4). El módulo bajo test (`./proceso-cierre.ts`)
 * TODAVÍA NO EXISTE en esta fase — `npm run typecheck` y
 * `npm test -- proceso-cierre` deben fallar los dos, a propósito.
 *
 * Esta primera tanda cubre SOLO modo y presupuesto (H2, H8, RD-121):
 *  - `esModoHeadless(env)`: `"1"` exacto ⇒ headless; ausente/""/blancos/"0"
 *    ⇒ TUI; cualquier otro valor ⇒ LANZA (falla cerrado, S-c).
 *  - `resolvePresupuestoCierreMs(deps)`: ausente/blanco ⇒ el default SIN
 *    evento; inválido (no numérico, ≤0, NaN, infinito) ⇒ el default Y UN
 *    evento `cierre-presupuesto-invalido`, SIN lanzar; numérico válido ⇒ ese
 *    valor.
 *  - Constantes: `PROCESO_LOG_CORRELATION_ID`, `DEFAULT_SHUTDOWN_TIMEOUT_MS`.
 *
 * `ProcesoLike` falso en toda la suite — CERO `process` real (R18).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { logTurnEvent } from "./core/logging/turn-logger.js";

/**
 * Doble mínimo de `logTurnEvent`, con la misma firma posicional, que junta
 * cada llamada en `eventos` en vez de escribir a disco. Misma idea que los
 * dobles de `deps` que ya usa `turn-logger.test.ts`.
 */
function crearLogEventEspia(): {
  readonly logEvent: typeof logTurnEvent;
  readonly eventos: { casoId: string; event: string; fields: Record<string, unknown> }[];
} {
  const eventos: { casoId: string; event: string; fields: Record<string, unknown> }[] = [];
  const logEvent: typeof logTurnEvent = (casoId, event, fields = {}) => {
    eventos.push({ casoId, event, fields: fields as Record<string, unknown> });
  };
  return { logEvent, eventos };
}

describe("proceso-cierre (modo-headless-cierre-limpio, tarea 2.1)", () => {
  describe("constantes", () => {
    it("PROCESO_LOG_CORRELATION_ID es 'proceso'", async () => {
      const { PROCESO_LOG_CORRELATION_ID } = await import("./proceso-cierre.js");
      expect(PROCESO_LOG_CORRELATION_ID).toBe("proceso");
    });

    it("DEFAULT_SHUTDOWN_TIMEOUT_MS es 70000 y es estrictamente mayor que 55500 (H9)", async () => {
      const { DEFAULT_SHUTDOWN_TIMEOUT_MS } = await import("./proceso-cierre.js");
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(70_000);
      expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(55_500);
    });
  });

  describe("esModoHeadless (H2, S-c)", () => {
    it("HARNESS_HEADLESS='1' exacto activa headless", async () => {
      const { esModoHeadless } = await import("./proceso-cierre.js");
      expect(esModoHeadless({ HARNESS_HEADLESS: "1" })).toBe(true);
    });

    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["en blanco", "   "],
      ['"0"', "0"],
    ] as const)("HARNESS_HEADLESS %s ⇒ TUI (false)", async (_etiqueta, valor) => {
      const { esModoHeadless } = await import("./proceso-cierre.js");
      const env = valor === undefined ? {} : { HARNESS_HEADLESS: valor };
      expect(esModoHeadless(env)).toBe(false);
    });

    it.each(["true", "yes", "on", "2", "01", " 1", "1 "])(
      "HARNESS_HEADLESS=%j falla cerrado: lanza Error con el nombre, el valor y los admitidos",
      async (valor) => {
        const { esModoHeadless } = await import("./proceso-cierre.js");
        let error: unknown;
        try {
          esModoHeadless({ HARNESS_HEADLESS: valor });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(Error);
        const mensaje = (error as Error).message;
        expect(mensaje).toContain("HARNESS_HEADLESS");
        expect(mensaje).toContain(`"${valor}"`);
        expect(mensaje).toContain("0");
        expect(mensaje).toContain("1");
      },
    );
  });

  describe("resolvePresupuestoCierreMs (H8, RD-121)", () => {
    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["en blanco", "   "],
    ] as const)(
      "HARNESS_SHUTDOWN_TIMEOUT_MS %s ⇒ 70000 SIN evento",
      async (_etiqueta, valor) => {
        const { resolvePresupuestoCierreMs } = await import("./proceso-cierre.js");
        const { logEvent, eventos } = crearLogEventEspia();
        const env = valor === undefined ? {} : { HARNESS_SHUTDOWN_TIMEOUT_MS: valor };
        expect(resolvePresupuestoCierreMs({ env, logEvent })).toBe(70_000);
        expect(eventos).toHaveLength(0);
      },
    );

    it.each(["abc", "0", "-5", "NaN", "Infinity", "1e400", "10s"])(
      "HARNESS_SHUTDOWN_TIMEOUT_MS=%j inválido ⇒ 70000 Y 1 evento cierre-presupuesto-invalido, sin lanzar",
      async (valor) => {
        const { resolvePresupuestoCierreMs, PROCESO_LOG_CORRELATION_ID } = await import(
          "./proceso-cierre.js"
        );
        const { logEvent, eventos } = crearLogEventEspia();
        let resultado: number | undefined;
        expect(() => {
          resultado = resolvePresupuestoCierreMs({
            env: { HARNESS_SHUTDOWN_TIMEOUT_MS: valor },
            logEvent,
          });
        }).not.toThrow();
        expect(resultado).toBe(70_000);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]?.casoId).toBe(PROCESO_LOG_CORRELATION_ID);
        expect(eventos[0]?.event).toBe("cierre-presupuesto-invalido");
        expect(eventos[0]?.fields).toMatchObject({ raw: valor });
      },
    );

    it("HARNESS_SHUTDOWN_TIMEOUT_MS='20000' ⇒ 20000", async () => {
      const { resolvePresupuestoCierreMs } = await import("./proceso-cierre.js");
      const { logEvent, eventos } = crearLogEventEspia();
      expect(
        resolvePresupuestoCierreMs({ env: { HARNESS_SHUTDOWN_TIMEOUT_MS: "20000" }, logEvent }),
      ).toBe(20_000);
      expect(eventos).toHaveLength(0);
    });
  });
});

/**
 * Test-first (RED) de `manejarErrorNoCapturado` (tarea 2.4, ADR 250, H6).
 * `salir: vi.fn()` — el `process.exit` real JAMÁS se toca. Sin cierre
 * ordenado: la política no recibe ni invoca ningún `close`/`db`.
 */
describe("manejarErrorNoCapturado (modo-headless-cierre-limpio, tarea 2.4, ADR 250)", () => {
  function crearDeps(): {
    readonly logEvent: typeof logTurnEvent;
    readonly eventos: { casoId: string; event: string; fields: Record<string, unknown> }[];
    readonly escribirError: ReturnType<typeof vi.fn<(linea: string) => void>>;
    readonly salir: ReturnType<typeof vi.fn<(codigo: number) => void>>;
  } {
    const { logEvent, eventos } = crearLogEventEspia();
    return {
      logEvent,
      eventos,
      escribirError: vi.fn<(linea: string) => void>(),
      salir: vi.fn<(codigo: number) => void>(),
    };
  }

  it.each([
    ["unhandledRejection", "boom"],
    ["uncaughtException", "kaput"],
  ] as const)("con Error y tipo %s: loguea, escribe y sale con 1", async (tipo, mensaje) => {
    const { manejarErrorNoCapturado, PROCESO_LOG_CORRELATION_ID } = await import(
      "./proceso-cierre.js"
    );
    const { logEvent, eventos, escribirError, salir } = crearDeps();

    manejarErrorNoCapturado(new Error(mensaje), tipo, { logEvent, escribirError, salir });

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.casoId).toBe(PROCESO_LOG_CORRELATION_ID);
    expect(eventos[0]?.event).toBe("proceso-error-no-capturado");
    expect(eventos[0]?.fields).toMatchObject({ tipo });
    expect(eventos[0]?.fields.message).toContain(mensaje);
    expect(escribirError).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(1);
  });

  it.each([["cadena"], [undefined], [null], [{ a: 1 }]])(
    "motivo no-Error (%j): no lanza, evento con representación textual, sale con 1",
    async (motivo) => {
      const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
      const { logEvent, eventos, escribirError, salir } = crearDeps();

      expect(() => {
        manejarErrorNoCapturado(motivo, "unhandledRejection", { logEvent, escribirError, salir });
      }).not.toThrow();

      expect(eventos).toHaveLength(1);
      expect(eventos[0]?.event).toBe("proceso-error-no-capturado");
      expect(typeof eventos[0]?.fields.message).toBe("string");
      expect(salir).toHaveBeenCalledWith(1);
    },
  );

  it("si logEvent lanza, igual se invoca escribirError y salir(1)", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const escribirError = vi.fn<(linea: string) => void>();
    const salir = vi.fn<(codigo: number) => void>();
    const logEvent: typeof logTurnEvent = () => {
      throw new Error("logger roto");
    };

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(escribirError).toHaveBeenCalledTimes(1);
    expect(salir).toHaveBeenCalledWith(1);
  });

  it("si escribirError lanza, igual se invoca salir(1)", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const { logEvent, salir } = crearDeps();
    const escribirError = vi.fn<(linea: string) => void>(() => {
      throw new Error("stderr roto");
    });

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(salir).toHaveBeenCalledWith(1);
  });

  it("si logEvent Y escribirError lanzan, salir(1) igual corre y ninguna excepción escapa", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const salir = vi.fn<(codigo: number) => void>();
    const logEvent: typeof logTurnEvent = () => {
      throw new Error("logger roto");
    };
    const escribirError = (): void => {
      throw new Error("stderr roto");
    };

    expect(() => {
      manejarErrorNoCapturado(new Error("boom"), "unhandledRejection", {
        logEvent,
        escribirError,
        salir,
      });
    }).not.toThrow();

    expect(salir).toHaveBeenCalledWith(1);
  });

  it("no recibe ni invoca ningún close/db: la política no toma dependencias de cierre ordenado", async () => {
    const { manejarErrorNoCapturado } = await import("./proceso-cierre.js");
    const { logEvent, escribirError, salir } = crearDeps();

    // Firma de tres parámetros: error, tipo, deps — sin un cuarto parámetro
    // de adaptadores/db. Si la firma cambiara para aceptar cierre ordenado,
    // este test (por aridad) fallaría.
    expect(manejarErrorNoCapturado.length).toBeLessThanOrEqual(3);

    manejarErrorNoCapturado(new Error("boom"), "uncaughtException", {
      logEvent,
      escribirError,
      salir,
    });
    expect(salir).toHaveBeenCalledWith(1);
  });
});
